/* eslint-disable max-len */
const {onRequest} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

const {Configuration, PlaidApi, PlaidEnvironments} = require("plaid");

// Initialize the Admin SDK
admin.initializeApp();

const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID;
const PLAID_SECRET = process.env.PLAID_CLIENT_SECRET;
const PLAID_ENV = process.env.PLAID_CLIENT_ENVIRONMENT;

const PLAID_PRODUCTS = ["auth", "transactions"];

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

const client = new PlaidApi(configuration);

exports.helloWorld = onRequest(async (request, response) => {
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

exports.createLinkTokenCent = onRequest( async (request, response) => {
  response.set("Access-Control-Allow-Origin", "http://localhost:3000");

  try {
    const redirectUri = "org.mobileapp.Niche-Capital://oauth-callback";

    const {userId, clientName} = request.body;
    if (!userId || !clientName) {
      return response.status(400).send("Missing userId or clientName");
    }

    const configs = {
      user: {
        client_user_id: userId,
      },
      client_name: clientName,
      products: PLAID_PRODUCTS,
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


exports.exchangeTokenCent = onRequest( async (request, response) => {
  response.set("Access-Control-Allow-Origin", "http://localhost:3000");

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
