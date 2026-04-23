import { MongoClient, Db, Filter, FindOptions, Document } from "mongodb";
import { ENV } from "./config";

// ─────────────────────────────────────────────────────────────
//  SINGLETON
// ─────────────────────────────────────────────────────────────

let mongoClient: MongoClient | null = null;
let mongoDB: Db | null = null;

export async function connectDB(): Promise<Db> {
  if (mongoDB) return mongoDB;
  mongoClient = new MongoClient(ENV.MONGODB_URI);
  await mongoClient.connect();
  mongoDB = mongoClient.db(ENV.MONGODB_DB);
  console.log(`  ✓ MongoDB → ${ENV.MONGODB_DB}`);
  return mongoDB;
}

async function getDB(): Promise<Db> {
  if (!mongoDB) await connectDB();
  return mongoDB!;
}

export async function closeDB(): Promise<void> {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
    mongoDB = null;
  }
}

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────

export async function insertOne(
  collection: string,
  doc: Document
): Promise<void> {
  const db = await getDB();
  await db.collection(collection).insertOne(doc);
}

export async function insertMany(
  collection: string,
  docs: Document[]
): Promise<void> {
  const db = await getDB();
  await db.collection(collection).insertMany(docs);
}

export async function findMany<T extends Document>(
  collection: string,
  filter: Filter<Document> = {},
  options: FindOptions = {}
): Promise<T[]> {
  const db = await getDB();
  return db.collection(collection).find(filter, options).toArray() as unknown as Promise<
    T[]
  >;
}

export async function findOne<T extends Document>(
  collection: string,
  filter: Filter<Document> = {}
): Promise<T | null> {
  const db = await getDB();
  return db.collection(collection).findOne(filter) as Promise<T | null>;
}

export async function countDocs(
  collection: string,
  filter: Filter<Document> = {}
): Promise<number> {
  const db = await getDB();
  return db.collection(collection).countDocuments(filter);
}
