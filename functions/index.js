/* eslint-disable require-jsdoc */
/* eslint-disable max-len */
const {onRequest} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const cors = require("cors");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {getFirestore} = require("firebase-admin/firestore");

// const {Storage} = require("@google-cloud/storage");
// const postmark = require("postmark");
const axios = require("axios");


const {Configuration, PlaidApi, PlaidEnvironments} = require("plaid");

// Initialize the Admin SDK
admin.initializeApp();
const firestore = admin.firestore();
const db = getFirestore();

// const storage = new Storage();
const bucket = admin.storage().bucket(); // Firebase Storage bucket

const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID;
const PLAID_SECRET = process.env.PLAID_CLIENT_SECRET;
const PLAID_ENV = process.env.PLAID_CLIENT_ENVIRONMENT;

const POSTMARK_API_KEY = process.env.POSTMARK_API_KEY;
const POSTMARK_FROMEMAIL= process.env.POSTMARK_FROM_EMAIL;
const SIMPLETEXTING_API_KEY = process.env.SIMPLETEXTING_API_KEY;
const SMS_SENDER = process.env.SIMPLETEXTING_ACCOUNTPHONE;

const PLAID_PRODUCTS = ["auth", "transactions", "assets"];

const PLAID_COUNTRY_CODES = ["US"];

let ACCESS_TOKEN = null;
let ITEM_ID = null;

const configuration = new Configuration({
  basePath: PlaidEnvironments[PLAID_ENV],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": PLAID_CLIENT_ID,
      "PLAID-SECRET": PLAID_SECRET,
      "Plaid-Version": "2020-09-14",
    },
  },
});

// const POSTMARK_CLIENT = new postmark.ServerClient(POSTMARK_API_KEY);

const corsMiddleware = cors({origin: true}); // Allow requests from all origins

const client = new PlaidApi(configuration);

exports.helloWorld = onRequest((request, response) => {
  corsMiddleware(request, response, async () => {
    try {
      if (!PLAID_CLIENT_ID || !PLAID_SECRET || !PLAID_ENV) {
        response.status(500).send("Environment variable not found!");
        return;
      }
      logger.info("Hello logs!");
      response.send("Hello from Firebase!");
    } catch (error) {
      console.error("Error in function execution:", error);
      response.status(500).send("An error occurred.");
    }
  });
});

exports.createLinkTokenCent = onRequest( (request, response) => {
  corsMiddleware(request, response, async () => {
    try {
      const redirectUri = "https://niche-capital.web.app/redirect.html";

      const {userId, clientName} = request.body;
      if (!userId || !clientName) {
        return response.status(400).send("Missing userId or clientName");
      }

      // Get current date
      const currentDate = new Date();

      // Calculate start_date (first day of three months ago)
      const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 3, 1);
      const formattedStartDate = startDate.toISOString().split("T")[0]; // Format as YYYY-MM-DD

      // Calculate end_date (last day of the previous month)
      const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0);
      let formattedEndDate = endDate.toISOString().split("T")[0]; // Format as YYYY-MM-DD

      const fifthOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 5);
      const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

      if (currentDate >= fifthOfMonth && currentDate <= lastDayOfMonth) {
        // Month-to-date: Start date is the first day of the current month
        // const mtdStartDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);

        formattedEndDate = currentDate.toISOString().split("T")[0]; // Format as YYYY-MM-DD
      }


      const configs = {
        user: {
          client_user_id: userId,
        },
        client_name: clientName,
        products: PLAID_PRODUCTS,
        required_if_supported_products: ["statements"],
        statements: {
          start_date: formattedStartDate,
          end_date: formattedEndDate,
        },
        country_codes: PLAID_COUNTRY_CODES,
        language: "en",
        redirect_uri: redirectUri,
        account_filters: {
          depository: {account_subtypes: ["checking", "savings"]},
        },
      };
      const createTokenResponse = await client.linkTokenCreate(configs);
      response.json(createTokenResponse.data);
    } catch (error) {
      console.error("Error in function execution:", error);
      response.status(500).send("An error occurred.");
    }
  });
});


exports.exchangeTokenCent = onRequest( (request, response) => {
  corsMiddleware(request, response, async () => {
    try {
      const {publicToken, clientUserId} = request.body;

      if (!publicToken || !clientUserId) {
        return response.status(400).send("Missing publicToken or UserId");
      }

      const exchangeResponse = await client.itemPublicTokenExchange({
        public_token: publicToken,
      });
      ACCESS_TOKEN = exchangeResponse.data.access_token;
      ITEM_ID = exchangeResponse.data.item_id;
      // ACCESS_TOKEN = "dddddddd";
      // ITEM_ID = "4533";
      await admin.firestore().collection("users").doc(clientUserId).update({
        access_token: ACCESS_TOKEN,
        item_id: ITEM_ID,
      });

      response.json({
        access_token: ACCESS_TOKEN,
        item_id: ITEM_ID,
        error: null,
      });
    } catch (error) {
      console.error("Error in function execution:", error);
      response.status(500).send("An error occurred.");
    }
  });
});

exports.uploadDocument = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    if (!req.body.file || !req.body.fileName) {
      return res.status(400).send("Missing file data");
    }

    const fileBuffer = Buffer.from(req.body.file, "base64");
    const fileName = `user_files/${req.body.uid}/${req.body.fileName}`;
    const file = bucket.file(fileName);

    await file.save(fileBuffer, {
      metadata: {contentType: req.body.contentType || "application/pdf"},
    });

    const downloadURL = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days expiry
    });

    res.status(200).json({message: "File uploaded successfully", downloadURL});
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).send("Internal Server Error");
  }
});

exports.sendUploadLink = onRequest(async (request, response) => {
  try {
    const {userId, documentName, email} = request.body;

    const docRef = await firestore.collection("linkdocument").add({
      documentName,
      status: true,
      uid: userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const docId = docRef.id; // Get the generated document ID
    console.log("New Document ID:", docId);
    const uploadLink = "http://localhost:3000/document-upload/"+docId;

    // await POSTMARK_CLIENT.sendEmail({
    //   From: POSTMARK_FROMEMAIL,
    //   To: email,
    //   Subject: "Secure Document Uploaded Link",
    //   TextBody: `Document "${documentName}" upload here.\nUpload Link: ${uploadLink}`,
    // });

    const data = JSON.stringify({
      "From": POSTMARK_FROMEMAIL,
      "To": email,
      "Subject": "Secure Document Uploaded Link",
      "TextBody": `Document "${documentName}" upload here.\nUpload Link: ${uploadLink}`,
      "MessageStream": "outbound",
    });

    const config = {
      method: "post",
      maxBodyLength: Infinity,
      url: "https://api.postmarkapp.com/email",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": POSTMARK_API_KEY,
      },
      data: data,
    };

    axios.request(config)
        .then((response) => {
          console.log(JSON.stringify(response.data));
          response.send("Email sent successfully to", email);
        })
        .catch((error) => {
          console.log(error);
          response.status(500).send("An error occurred.");
        });


    response.status(200).json({message: "Email Link send successfully"});
  } catch (error) {
    response.status(500).send("Internal Server Error");
  }
});

exports.sendUserNotification = onDocumentCreated("users/{userId}/notifications/{docID}", async (event) => {
  const snapshot = event.data;
  console.log("Data "+snapshot.data());

  if (!snapshot) return;

  const context = event.params;
  const userId = context.userId;
  const docID = context.docID;
  const notificationData = snapshot.data();

  if (!notificationData) return;

  // Fetch user details from Firestore
  const userRef = db.collection("users").doc(userId);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    console.log("User "+userId+" not found.");
    return;
  }

  const user = userDoc.data();
  const email = user.email;
  const phoneNumber = user.phoneNumber;
  const setting = user.settings;
  const token = user.fcmToken;

  // Send notifications if user has email or phoneNumber
  if (setting.email && email) {
    await sendEmailNotification(email, notificationData);
  }

  if (setting.sms && phoneNumber) {
    await sendSMSNotification(phoneNumber, notificationData);
  }

  if (setting.push && token) {
    await sendPUSHNotification(userId, docID, token, notificationData);
  }
});


// eslint-disable-next-line require-jsdoc
async function sendEmailNotification(email, notification) {
  try {
    if (POSTMARK_API_KEY) {
      // const POST_MARK_CLIENT = new postmark.ServerClient(POSTMARK_API_KEY);
      // await POST_MARK_CLIENT.sendEmail({
      //   From: POSTMARK_FROMEMAIL,
      //   To: email,
      //   Subject: notification.title || "New Notification",
      //   TextBody: notification.message,
      // });

      const data = JSON.stringify({
        "From": POSTMARK_FROMEMAIL,
        "To": email,
        "Subject": notification.title || "New Notification",
        "TextBody": notification.message,
        "MessageStream": "outbound",
      });

      const config = {
        method: "post",
        maxBodyLength: Infinity,
        url: "https://api.postmarkapp.com/email",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": POSTMARK_API_KEY,
        },
        data: data,
      };

      axios.request(config)
          .then((response) => {
            console.log(JSON.stringify(response.data));
          })
          .catch((error) => {
            console.log(error);
          });
    }
    console.log("Email sent successfully to", email);
  } catch (error) {
    console.log("Error sending email:", error);
  }
}

// eslint-disable-next-line require-jsdoc
async function sendSMSNotification(phoneNumber, notification) {
  const data = JSON.stringify({
    "contactPhone": phoneNumber,
    "accountPhone": SMS_SENDER,
    "mode": "AUTO",
    "subject": notification.subject,
    "text": notification.message,
  });

  const config = {
    method: "post",
    maxBodyLength: Infinity,
    url: "https://api-app2.simpletexting.com/v2/api/messages",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer "+SIMPLETEXTING_API_KEY,
    },
    data: data,
  };

  axios.request(config)
      .then((response) => {
        console.log(JSON.stringify(response.data));
      })
      .catch((error) => {
        console.log(error);
      });
}

async function sendPUSHNotification(userId, docID, fcmToken, notification) {
  if (!fcmToken) {
    console.log("No FCM token found for user", userId);
    return;
  }

  // Construct push notification payload
  const message = {
    token: fcmToken,
    notification: {
      title: notification.subject || "New Notification",
      body: notification.message,
    },
    data: {
      userId: userId,
      docID: docID,
    },
  };

  try {
    await admin.messaging().send(message);
    console.log("Push notification sent successfully to", userId);
  } catch (error) {
    console.log("Error sending push notification:", error);
  }
}
