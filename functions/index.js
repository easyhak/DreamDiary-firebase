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
exports.needSync = onRequest({
  region: "asia-northeast3",
}, async (request, response) => {

  // 1. user가 맞는지 확인
  // 2. diary id의 데이터를 가져온다.
  // 3. diary의 id가 없으면 새로 생성
  // 4. diary의 id가 있으면 주어진 데이터로 업데이트

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


// 일기 needSync는 true인것만 동기화
exports.syncDiaries = onRequest({
  region: "asia-northeast3",
}, async (request, response) => {
  try {
    const { list } = request.body;

    if (!Array.isArray(list) || list.length === 0) {
      response.status(400).send({ error: "Invalid or empty 'list' in request body" });
      return;
    }

    const updatedVersions = [];

    for (const diary of list) {
      const { userId, diaryId, createdAt, updatedAt, sleepStartAt, sleepEndAt, labels, version } = diary;

      // 필수 필드 검증
      if (!userId || !diaryId) {
        response.status(400).send({ error: `Missing required fields for diaryId: ${diaryId}` });
        return;
      }

      // 1. 사용자 존재 여부 확인
      // const userDoc = await firestore.collection("users").doc(userId).get();
      // if (!userDoc.exists) {
      //   response.status(404).send({ error: `User ${userId} does not exist` });
      //   return;
      // }

      // 2. 기존 diary 데이터 가져오기
      const diaryRef = firestore.collection("users").doc(userId).collection("diaries").doc(diaryId);
      const diaryDoc = await diaryRef.get();

      let newVersion = Date.now(); // version 업데이트: epoch time 사용

      if (diaryDoc.exists) {
        // 2-1. 기존 데이터 업데이트
        await diaryRef.update({
          updatedAt,
          sleepStartAt,
          sleepEndAt,
          labels,
          version: newVersion, // 새 버전으로 업데이트
        });
      } else {
        // 2-2. 새로운 데이터 생성
        await diaryRef.set({
          diaryId,
          userId,
          createdAt,
          updatedAt,
          sleepStartAt,
          sleepEndAt,
          labels,
          version: newVersion, // 새 버전 설정
        });
      }

      // 3. 업데이트된 version 기록
      updatedVersions.push({ diaryId, version: newVersion });
    }

    // 리턴 값으로 업데이트된 버전 배열 반환
    response.status(200).send({ updatedVersions });
  } catch (error) {
    console.error("Error syncing diaries:", error);
    response.status(500).send({ error: error.message });
  }
});

// 일기 needSync는 true인것만 동기화
exports.needSync = onCall({
  region: "asia-northeast3",
}, async (request, response) => {

  logger.info(request.data)

  try {
    const { list } = request.data;

    if (!Array.isArray(list) || list.length === 0) {
      return { error: "Invalid or empty 'list' in request body", isSuccess: false };
    }

    // user id 검증
    const userId = request.auth.uid 
    if(!request.auth.uid) {
      return { error: "Invalid user", isSuccess: false };
    }

    const updatedVersions = [];

    for (const diary of list) {
      const {diaryId, createdAt, updatedAt, sleepStartAt, sleepEndAt, labels, version } = diary;

      // 필수 필드 검증
      if (!diaryId) {
        return {
           error: `Missing required fields for diaryId: ${diaryId}`,
           "isSuccess": false
        };
      }

      // 1. 기존 diary 데이터 가져오기
      const diaryRef = firestore.collection("users").doc(userId).collection("diaries").doc(diaryId);
      const diaryDoc = await diaryRef.get();

      // version 업데이트: epoch time 사용
      let newVersion = Date.now(); 

      if (diaryDoc.exists) {
        // 1-1. 기존 데이터 업데이트
        await diaryRef.update({
          updatedAt,
          sleepStartAt,
          sleepEndAt,
          labels,
          version: newVersion,
        });
      } else {
        // 1-2. 새로운 데이터 생성
        await diaryRef.set({
          diaryId,
          userId,
          createdAt,
          updatedAt,
          sleepStartAt,
          sleepEndAt,
          labels,
          version: newVersion,
        });
      }

      // 3. 업데이트된 version 기록
      updatedVersions.push({ diaryId, version: newVersion });
    }

    // 리턴 값으로 업데이트된 버전 배열 반환
    logger.info("Synced diaries:", updatedVersions);
    return {
      updatedVersions, 
      "isSuccess": true
    };
  } catch (error) {
    return { 
      error: error.message,
      "isSuccess": false
    };
  }
});
