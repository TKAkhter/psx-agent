"use strict";
const { MongoClient } = require("mongodb");
const { ENV } = require("./config");

let mongoClient = null;
let mongoDB = null;

async function connectDB() {
    if (mongoDB) return mongoDB;
    mongoClient = new MongoClient(ENV.MONGODB_URI);
    await mongoClient.connect();
    mongoDB = mongoClient.db(ENV.MONGODB_DB);
    console.log(`  ✓ MongoDB → ${ENV.MONGODB_DB}`);
    return mongoDB;
}

async function getDB() {
    if (!mongoDB) await connectDB();
    return mongoDB;
}

async function closeDB() {
    if (mongoClient) {
        await mongoClient.close();
        mongoClient = null;
        mongoDB = null;
    }
}

async function insertOne(collection, doc) {
    const db = await getDB();
    return db.collection(collection).insertOne(doc);
}

async function findMany(collection, filter = {}, options = {}) {
    const db = await getDB();
    return db.collection(collection).find(filter, options).toArray();
}

async function findOne(collection, filter = {}) {
    const db = await getDB();
    return db.collection(collection).findOne(filter);
}

async function countDocs(collection, filter = {}) {
    const db = await getDB();
    return db.collection(collection).countDocuments(filter);
}

module.exports = { connectDB, getDB, closeDB, insertOne, findMany, findOne, countDocs };