declare type MemorySize = 128 | 196 | 256 | 384 | 512 | 1024;
export interface Config {
    memory_size: MemorySize;
    proxy_url: string;
    boot: boolean;
    print: boolean;
    db_password?: string;
}
declare type PostgresInstance = {
    connection_string: string;
    db_password: string;
};
/**
 * Spin up a v86 emulator running PostgreSQL WASM.
 * Returns the connection string.
 */
export declare const postgresWASM: (user_config?: Partial<Config>) => Promise<PostgresInstance>;
export {};
