import { WebSocket } from 'ws';
global['WebSocket'] = WebSocket as any;

import chalk from 'chalk';
import crypto from 'crypto';
import { V86Starter, type V86Options } from './v86/libv86';

type MemorySize = 128 | 196 | 256 | 384 | 512 | 1024;

export interface Config {
	memory_size: MemorySize;
	proxy_url: string;
	boot: boolean;
	print: boolean;
	db_password?: string;
}

let config: Config = {
	memory_size: 128,
	proxy_url: 'wss://proxy.wasm.supabase.com/',
	boot: false,
	print: false,
};

const baseOptions: V86Options = {
	wasm_path: './v86/v86.wasm',
	memory_size: config.memory_size * 1024 * 1024,
	filesystem: {
		basefs: 'filesystem/filesystem.json',
		baseurl: 'filesystem/',
	},
	network_relay_url: config.proxy_url,
	preserve_mac_from_state_image: false,
	mac_address_translation: false,
	autostart: true,
	disable_keyboard: true,
	disable_mouse: true,
	disable_speaker: true,
	acpi: true,
};

const options = {
	...baseOptions,
	...(config.boot
		? {
				bzimage: {
					url: './filesystem/0f8b7fb4.bin',
				},
				cmdline: [
					'rw',
					'root=host9p rootfstype=9p',
					'rootflags=version=9p2000.L,trans=virtio,cache=loose',
					'quiet acpi=off console=ttyS0',
					'tsc=reliable mitigations=off random.trust_cpu=on',
					'nowatchdog page_poison=on',
				].join(' '),
				bios: {
					url: './system/seabios.bin',
				},
				vga_bios: {
					url: './system/vgabios.bin',
				},
		  }
		: {
				initial_state: {
					url: './state/state-' + config.memory_size + '.bin.zst',
				},
		  }),
};

let emulator: V86Starter;

type PostgresInstance = {
	connection_string: string;
	db_password: string;
};
let resolve: (res: PostgresInstance) => void = () => {};
/**
 * Spin up a v86 emulator running PostgreSQL WASM.
 * Returns the connection string.
 */
export const postgresWASM = (
	user_config?: Partial<Config>
): Promise<PostgresInstance> =>
	new Promise((_resolve) => {
		config.db_password =
			user_config?.db_password || crypto.randomBytes(20).toString('hex');
		config = { ...config, ...user_config };
		emulator = new V86Starter(options);
		resolve = _resolve; // should really be async/promises all the way down instead

		if (!config.boot) {
			emulator.add_listener('emulator-ready', () => {
				log('Emulator ready');
				setTimeout(() => emulator.serial0_send('\u000a'), 1);
				setTimeout(set_password, 10);
				setTimeout(get_new_ip, 100);
			});
		} else {
			emulator.add_listener('serial0-output-line', (line: string) => {
				if (line.startsWith('server started')) {
					setTimeout(set_password, 0);
				}
				if (line.startsWith('postgres=#')) {
					setTimeout(() =>
						emulator.serial0_send('psql -U postgres\n')
					);
					setTimeout(get_new_ip, 100);
				}
			});
		}
	});

if (process.argv.includes('run')) {
	config.print = true;
	postgresWASM();
}

const tag = chalk.bgAnsi256(31)('PG-WASM');
function log(...messages: string[]) {
	if (config.print) console.log(tag, ...messages);
}

let get_address_counter = 0;
async function get_address() {
	let result = '';
	try {
		const contents = await emulator.read_file('/addr.txt');
		result = new TextDecoder().decode(contents).replace(/\n/g, '');
		// result = '192.168.1.01';
	} catch (err: any) {
		if (err && err.message && err.message === 'File not found') {
			log('Connecting network...');
		} else {
			const msg = 'Error initializing network: ' + err;
			log(chalk.red(msg));
			throw new Error(msg);
		}
	} finally {
		if (result && result.length > 0) {
			const arr = result.split('.');
			// pad arr[3] with leading zeros
			arr[3] = arr[3].padStart(3, '0');
			let port = arr[2] + arr[3];
			// port = (
			// 	Math.floor(Math.random() * (65353 - 1023)) + 1023
			// ).toString();
			let proxy_domain = config.proxy_url.split('//')[1] || 'NO_PROXY';
			if (proxy_domain.endsWith('/'))
				proxy_domain = proxy_domain.slice(0, -1);

			if (!config.db_password) throw Error('No database password');
			const pg_address = `postgres://postgres:${config.db_password}@${proxy_domain}:${port}`;
			resolve({
				connection_string: pg_address,
				db_password: config.db_password,
			});

			log(
				'host:',
				chalk.green(proxy_domain),
				' port:',
				chalk.green(port),
				' password:',
				chalk.green(config.db_password)
			);
			log(chalk.blue(pg_address));

			get_address_counter = 0;
		} else {
			if (get_address_counter < 22) {
				get_address_counter++;
				setTimeout(() => {
					send_script(
						'script_name',
						`ip route get 1 | awk '{print $7}' &> /addr.txt\n
            sync\n`
					);
				}, 2000);
				setTimeout(get_address, 1000);
			} else {
				get_address_counter = 0;
				const msg = 'Connecting network to network failed.';
				log(chalk.red(msg));
				throw new Error(msg);
			}
		}
	}
}

function send_script(name: string, text: string) {
	const script = new TextEncoder().encode(text);
	emulator.create_file('/inbox/' + name + '.sh', script);
}

function get_new_ip() {
	send_script(
		'get_new_ip',
		`
		  echo 0000:00:05.0 > /sys/bus/pci/drivers/ne2k-pci/unbind &&
		  echo 0000:00:05.0 > /sys/bus/pci/drivers/ne2k-pci/bind &&
		  sleep 1 &&
		  /etc/init.d/S40network restart`
	);
	setTimeout(get_address, 2000);
}

function set_password() {
	const cmd = `ALTER ROLE postgres WITH PASSWORD '${config.db_password}';\n`;
	emulator.serial0_send(cmd);
}
