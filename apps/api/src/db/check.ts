import postgres from 'postgres';
const client = postgres(process.env.DATABASE_ADMIN_URL!, { max: 1 });
client.unsafe("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'").then(rows => {
  console.log(rows);
  client.end();
});
