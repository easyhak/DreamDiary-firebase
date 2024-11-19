// The Cloud Functions for Firebase SDK to create Cloud Functions and triggers.
const {logger} = require("firebase-functions");
const {onCall, onRequest} = require("firebase-functions/v2/https");
const {initializeApp} = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { auth } = require("firebase-admin");

initializeApp();

const firestore = getFirestore();

exports.helloWorld = onCall({
  region: "asia-northeast3",
}, (request) => {
  logger.info(request.auth.uid);
  logger.info(request)
  logger.info("Hello logs!", { structuredData: true });
  return "Hello from Firebase!";
});


// need synced 는 true인 애들만 보내줌
exports.sync = onRequest({
  region: "asia-northeast3",
}, async (request, response) => {

  // list 형태로 firebase 안에 있는 user의 uid 에 맞는 data를 가져온다.
  try {
    const { userId } = request.body;

    if (!userId) {
      response.status(400).send({ error: "Missing required field: userId" });
      return;
    }

    const snapshot = await firestore.collection("diaries")
      .where("userId", "==", userId)
      .get();

    if (snapshot.empty) {
      response.status(404).send({ error: "No diaries found for this user" });
      return;
    }
    const diaries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    response.status(200).send({ data: diaries });

    // diary 버전 비교
  } catch (error) {
    console.error("Error fetching diaries:", error);
    response.status(500).send({ error: error.message });
  }

  try {
    const { items } = request.body;

    logger.info("Syncing data:", items);
    if (!items.list) {
      response.status(400).send({ error: "Missing required fields: title, content, uid" });
      return;
    }

    const docRef = await firestore.collection("users").doc(uid).collection("diaries").add({
      title,
      content,
      isSynced: false,
      createdAt: new Date(),
    });

    response.status(200).send({ success: true, id: docRef.id });
  } catch (error) {
    logger.error("Error syncing data:", error);
    response.status(500).send({ success: false, error: error.message });
  }
});

// 일기 추가
exports.addDiary = onRequest({
  region: "asia-northeast3",
}, async (request, response) => {
  // list 형태로 들어옴

  try {
    const {
      userId,
      diaryId,
      title,
      createdAt,
      updatedAt,
      sleepStartAt,
      sleepEndAt,
      labels,
      version
    } = request.body;

    if (!userId || !diaryId || !title) {
      response.status(400).send({ error: "Missing required fields" });
      return;
    }

    await firestore.collection("diaries").doc(diaryId).set({
      userId,
      diaryId,
      title,
      createdAt,
      updatedAt,
      sleepStartAt,
      sleepEndAt,
      labels,
      version
    });

    response.status(200).send({ success: true, message: "Diary added successfully" });
  } catch (error) {
    console.error("Error adding diary:", error);
    response.status(500).send({ error: error.message });
  }
});

// user의 일기를 가져오기
exports.getUserDiaries = onRequest({
  region: "asia-northeast3",
}, async (request, response) => {
  try {
    const { userId } = request.body;

    if (!userId) {
      response.status(400).send({ error: "Missing required field: userId" });
      return;
    }

    const snapshot = await firestore.collection("diaries")
      .where("userId", "==", userId)
      .get();

    if (snapshot.empty) {
      response.status(404).send({ error: "No diaries found for this user" });
      return;
    }

    const diaries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    response.status(200).send({ data: diaries });
  } catch (error) {
    console.error("Error fetching diaries:", error);
    response.status(500).send({ error: error.message });
  }
});