import mysql, { type Pool } from "mysql2/promise";

import { env } from "./env";

let pool: Pool | null = null;

const createPool = () =>
  mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

export const getDatabasePool = () => {
  if (!pool) {
    pool = createPool();
  }

  return pool;
};

export const checkDatabaseConnection = async () => {
  const connection = await getDatabasePool().getConnection();

  try {
    await connection.query("SELECT 1");
    return true;
  } finally {
    connection.release();
  }
};

export const closeDatabasePool = async () => {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
};
