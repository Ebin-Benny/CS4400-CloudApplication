const cors = require("cors");
const express = require("express");
const logger = require("morgan");
const AWS = require("aws-sdk");
const _cliProgress = require("cli-progress");

AWS.config.update({ region: "eu-west-1" });

var dynamodb = new AWS.DynamoDB({
  region: "eu-west-1",
  endpoint: "http://localhost:8000"
});

var s3 = new AWS.S3({ region: "eu-west-1" });

var tableParams = {
  TableName: "Movies",
  KeySchema: [
    { AttributeName: "year", KeyType: "HASH" },
    { AttributeName: "title", KeyType: "RANGE" }
  ],
  AttributeDefinitions: [
    { AttributeName: "year", AttributeType: "N" },
    { AttributeName: "title", AttributeType: "S" }
  ],
  ProvisionedThroughput: {
    ReadCapacityUnits: 10,
    WriteCapacityUnits: 10
  }
};

const bucketParams = {
  Bucket: "csu44000assignment2",
  Key: "moviedata.json"
};

const API_PORT = 3000;
const app = express();
const router = express.Router();

app.use(cors());
app.use(logger("dev"));

/**
 * Creates the table
 */
router.get("/createDB", cors(), async (req, res) => {
  try {
    await createTable();
    populateTable();
    return res.json({});
  } catch (e) {
    throw new Error(e);
  }
});

/**
 * Queries the table
 */
router.get("/queryMovie", cors(), async (req, res) => {
  try {
    const year = req.query.year;
    const title = req.query.title;
    if (!year || !title) {
      return res.sendStatus(404);
    }
    const result = await queryTable(year, title);
    return res.json(result);
  } catch (e) {
    throw new Error(e);
  }
});

/**
 * Deletes the table
 */
router.get("/dropDB", cors(), async (req, res) => {
  try {
    await deleteTable();
    return res.json({});
  } catch (e) {
    throw new Error(e);
  }
});

app.use("/", router);
app.disable("etag");

app.listen(API_PORT, () => console.log(`LISTENING ON PORT ${API_PORT}`));

/**
 * Searches the table for movies in a certain year and starts with a certain title.
 * @param {number} year - The year to search for.
 * @param {string} title - The start of the title to search for.
 */
const queryTable = async (year, title) => {
  var queryParams = {
    TableName: "Movies",
    ProjectionExpression: "#yr, title, info",
    KeyConditionExpression: "#yr = :yyyy and begins_with(title, :startString)",
    ExpressionAttributeNames: {
      "#yr": "year"
    },
    ExpressionAttributeValues: {
      ":yyyy": +year,
      ":startString": title
    }
  };

  const docClient = new AWS.DynamoDB.DocumentClient({
    region: "eu-west-1",
    endpoint: "http://localhost:8000"
  });

  const result = await new Promise(resolve => {
    docClient.query(queryParams, (err, data) => {
      if (err) {
        throw new Error(err.message);
      } else {
        resolve(data.Items);
      }
    });
  });
  return result;
};

/**
 * Checks if the table already exists.
 */
const checkIfTableExists = async () => {
  const exists = await new Promise(resolve => {
    dynamodb.describeTable({ TableName: "Movies" }, (err, data) => {
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
  return exists;
};

/**
 * Creates the table if it doesn't exists.
 */
const createTable = async () => {
  const tableExists = await checkIfTableExists();
  if (tableExists) return tableExists;

  const created = await new Promise(resolve => {
    dynamodb.createTable(tableParams, (err, data) => {
      if (err) {
        throw new Error(err.message);
      }
      resolve(data);
    });
  });
  return created;
};

/**
 * Deletes the table if it exists.
 */
const deleteTable = async () => {
  const tableExists = await checkIfTableExists();
  if (!tableExists) return tableExists;

  const deleted = await new Promise(resolve => {
    dynamodb.deleteTable({ TableName: "Movies" }, (err, data) => {
      if (err) {
        throw new Error(err.message);
      } else {
        resolve(data);
      }
    });
  });
  return deleted;
};

/**
 * Populates the table with items from the s3 bucket.
 */
const populateTable = async () => {
  const movieData = await new Promise(resolve => {
    s3.getObject(bucketParams, (err, data) => {
      if (err) {
        throw new Error(err.message);
      }
      resolve(JSON.parse(data.Body));
    });
  });

  const docClient = new AWS.DynamoDB.DocumentClient({
    region: "eu-west-1",
    endpoint: "http://localhost:8000"
  });

  const cliProgressBar = new _cliProgress.SingleBar(
    {},
    _cliProgress.Presets.shades_classic
  );

  cliProgressBar.start(movieData.length, 0);

  let progress = 0;
  for (let movie of movieData) {
    const movieParams = {
      TableName: "Movies",
      Item: { year: movie.year, title: movie.title, info: movie.info }
    };

    docClient.put(movieParams, (err, data) => {
      cliProgressBar.update(++progress);
      if (err) {
        throw new Error(err.message);
      }

      if (progress >= movieData.length) {
        cliProgressBar.stop();
      }
    });
  }
};
