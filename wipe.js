/**
 * ⚠️ DANGER ZONE ⚠️
 * This script permanently deletes:
 * - ALL Firebase Auth users
 * - ALL Firestore collections & documents
 *
 * Run ONLY if you understand the consequences.
 */

const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccount.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const auth = admin.auth();
const db = admin.firestore();

/* ---------------- DELETE AUTH USERS ---------------- */

async function deleteAllAuthUsers(nextPageToken) {
  const result = await auth.listUsers(1000, nextPageToken);

  if (result.users.length > 0) {
    const uids = result.users.map(user => user.uid);
    await auth.deleteUsers(uids);
    console.log(`Deleted ${uids.length} auth users`);
  }

  if (result.pageToken) {
    await deleteAllAuthUsers(result.pageToken);
  }
}

/* ---------------- DELETE FIRESTORE DATA ---------------- */

async function deleteCollection(collectionPath, batchSize = 500) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(query, resolve) {
  const snapshot = await query.get();

  if (snapshot.size === 0) {
    resolve();
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();

  process.nextTick(() => {
    deleteQueryBatch(query, resolve);
  });
}

async function wipeFirestore() {
  const collections = await db.listCollections();
  for (const collection of collections) {
    console.log(`Deleting collection: ${collection.id}`);
    await deleteCollection(collection.id);
  }
}

/* ---------------- EXECUTE WIPE ---------------- */

(async () => {
  try {
    console.log("🔥 Starting Firebase wipe...");

    console.log("Deleting Auth users...");
    await deleteAllAuthUsers();

    console.log("Deleting Firestore data...");
    await wipeFirestore();

    console.log("✅ WIPE COMPLETE");
    process.exit(0);
  } catch (err) {
    console.error("❌ WIPE FAILED:", err);
    process.exit(1);
  }
})();
