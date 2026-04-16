"use strict";
const { MongoClient } = require("mongodb");
const { ENV } = require("./config");

let client = null;
let db = null;

async function connect() {
    if (db) return db;
    client = new MongoClient(ENV.MONGODB_URI);
    await client.connect();
    db = client.db(ENV.MONGODB_DB);
    console.log(`  ✓ MongoDB connected → ${ENV.MONGODB_DB}`);
    return db;
}

async function getDb() {
    if (!db) await connect();
    return db;
}

async function close() {
    if (client) {
        await client.close();
        client = null;
        db = null;
    }
}

async function insertOne(collection, doc) {
    const d = await getDb();
    return d.collection(collection).insertOne(doc);
}

async function findMany(collection, filter = {}, options = {}) {
    const d = await getDb();
    return d.collection(collection).find(filter, options).toArray();
}

async function findOne(collection, filter = {}) {
    const d = await getDb();
    return d.collection(collection).findOne(filter);
}

async function countDocs(collection, filter = {}) {
    const d = await getDb();
    return d.collection(collection).countDocuments(filter);
}

module.exports = { connect, getDb, close, insertOne, findMany, findOne, countDocs };