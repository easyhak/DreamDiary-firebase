// The Cloud Functions for Firebase SDK to create Cloud Functions and triggers.
const {logger} = require("firebase-functions");
const {onCall, onRequest} = require("firebase-functions/v2/https");
const {initializeApp} = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { auth } = require("firebase-admin");
const { randomUUID } = require('crypto');

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

// 클라이언트의 모든 꿈일기 버전 정보를 가져와서 비교
exports.version = onCall({
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

    // TODO: 이름
    const diaries = []

    for (const diary of list) {
      const {diaryId, version: prevVersion } = diary;
      

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

      // 2. 존재하는지 확인하기
      if (diaryDoc.exists) {
        const diaryData = diaryDoc.data();
        
        const { diaryId, title, createdAt, updatedAt, sleepStartAt, sleepEndAt, labels, version } = diaryData;

        // 3. 파이어스토어에 있는 꿈일기가 더 최신 버전인 경우 클라이언트에게 알려주기
        if (prevVersion < version) {
          diaries.push(
            {
              diaryId, title, createdAt, updatedAt, sleepStartAt, sleepEndAt, labels, version 
            }
          )
        }
      }
    }

    return {
      diaries, 
      isSuccess: true
    };

  } catch (error) {
    return { 
      error: error.message,
      "isSuccess": false
    };
  }
});

// needSync는 true 인것만 확인하기
exports.needSync = onCall({
  region: "asia-northeast3",
}, async (request, response) => {

  logger.info(request.data)

  try {
    const {
      diaryId,
      title,
      createdAt,
      updatedAt,
      sleepStartAt,
      sleepEndAt,
      labels,
      content,
      previousVersion,
      currentVersion
    } = request.data;

    // user id 검증
    const userId = request.auth.uid
    if(!request.auth.uid) {
      return { error: "Invalid user", isSuccess: false };
    }
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

    // 2. 존재하는지 확인하기
    if (diaryDoc.exists) {
      const serverDiaryData = diaryDoc.data();
      const { versionList } = serverDiaryData;

      // 만약 previousVersion이 server에서의 가장 최신이면 바로 그냥 update
      // 클라이언트에서만 새로운 꿈일기가 생겼을 때 상황임.
      const lastServerVersion = versionList[versionList.length - 1]
      if (previousVersion === lastServerVersion) {
        await diaryRef.update({
          title,
          updatedAt,
          sleepStartAt,
          sleepEndAt,
          labels,
          content,
          versionList: [...versionList, currentVersion]
        });

        return {
          currentVersion,
          "isSuccess": true
        };
      } else {
        if (versionList.indexOf(currentVersion)) {
          // 만약 클라이언트의 currentVersion이 서버의 versionList에 속한 경우 해당 클라이언트는 구버전의 데이터를 들고 있음
          // 그러므로 서버의 꿈일기만을 클라이언트에게 전달함
          const {
            createdAt, labels, sleepEndAt, sleepStartAt, title, updatedAt, content
          } = serverDiaryData;

          const responseDiary = {  createdAt, labels, sleepEndAt, sleepStartAt, title, updatedAt, content }
          return {
            currentVersion: lastServerVersion,
            updateDiary: responseDiary,
            "isSuccess": true,
          }

        } else {
          // 항상 충돌 상황인가??

          // 충돌 난 경우 더하기
          const newVersion = randomUUID();

          const newDiary = {
            title: title + serverDiaryData.title,
            labels: [...labels , ...serverDiaryData.labels],
            content: content + serverDiaryData.content,
          }

          await diaryRef.update({
            ...newDiary,
            versionList: [...versionList, currentVersion, newVersion] // 클라이언트가 전달한 currentVersion이 merge가 된 느낌
          });

          return {
            currentVersion: newVersion,
            newDiary: newDiary,
            "isSuccess": true
          }
        }
      }
    }
    
    // 서버에 데이터가 없는 경우
    else {
      // 그냥 add 해주기
      await diaryRef.set({
        diaryId,
        title,
        createdAt,
        updatedAt,
        sleepStartAt,
        sleepEndAt,
        labels,
        content,
        versionList: [previousVersion, currentVersion]
      });
      return {
        currentVersion,
        "isSuccess": true
      };
      
    }
} catch(error){
    return { 
      error: error.message,
      "isSuccess": false
    };
  }
});

// 버전 함수 -> 버전 정보만 비교하기
// 클라이언트의 current version이 서버의 마지막 version이랑 다르면 무조건 동기화를 진행을 해야 함 -> 
// 마지막 server version이랑 클라이언트가 보내주는 current version이 다르면 diary Id를 보내주고
// 클라이언트가 보내준 diary id 중에 서버에만 있으면 diary id만 보내주기

exports.versionCheck = onCall({
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

    // userId 에 맞는 모든 diaries 가져오기
    const snapshot = await firestore.collection("users").doc(userId).collection("diaries").get();
    const serverDiaries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // 동기화해야하는 diaries list
    const needSyncDiaries = []

    // 존재하는지 확인하기
    if (serverDiaries.exists) {
      const serverDiaryData = serverDiaries.data();
      const serverDiaryMap = {};
      for (const serverDiary of serverDiaryData) {
        serverDiaryMap[serverDiary.diaryId] = serverDiary;
      }

      for (const diary of list) {
        const {diaryId, version} = diary;
        const serverDiary = serverDiaryMap[diaryId]

        // server에 존재하는 경우
        if (serverDiary) {
          const serverVersionList = serverDiary.versionList;
          const serverLatestVersion = serverVersionList[serverVersionList.length - 1];
    
          if (serverLatestVersion !== version) {
            needSyncDiaries.push(diaryId);
          }
        }
        // server에 존재하지 않는 경우
        else {
          needSyncDiaries.push(diaryId);
        }
      }
      return {
        needSyncDiaries,
        isSuccess: true
      }
    }
    

  } catch (error){
    return {
      isSuccess: false
    }
  }
});
