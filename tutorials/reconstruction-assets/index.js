"use strict";

const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { createReadStream } = require("fs");

// Replace <your_access_token> below with a token from your ion account.
// This example requires a token with assets:list, assets:read, and assets:write scopes.
// Tokens page: https://cesium.com/ion/tokens
const accessToken = "<your-access-token-here>";

// Sample data is already included in this repository, but you can modify the below
// path to point to any CityGML data you would like to upload.
const input = "images.zip";

// The name of the asset that you want to create
const name = "Test Script";

// The base URL of the API. Leave this as-is unless using self hosted.
const apiBase = "https://api.ion.cesium.com";

async function waitUntilReady(assetId) {
  // Issue a GET request for the metadata
  const assetMetadataResponse = await fetch(`${apiBase}/v1/assets/${assetId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  const assetMetadata = await assetMetadataResponse.json();

  const assetIdAndName = `${assetMetadata.id} - ${assetMetadata.name}`;

  const status = assetMetadata.status;
  if (status === "COMPLETE") {
    console.log(`${assetIdAndName} successfully`);
    console.log(
      `View in ion: https://cesium.com/ion/assets/${assetMetadata.id}`
    );
  } else if (status === "DATA_ERROR") {
    console.log(
      `ion detected a problem with the uploaded data for ${assetIdAndName}.`
    );
  } else if (status === "ERROR") {
    console.log(
      `An unknown tiling error occurred, please contact support@cesium.com regarding ${assetIdAndName}`
    );
  } else {
    if (status === "NOT_STARTED") {
      console.log(`Tiling pipeline initializing for ${assetIdAndName}`);
    } else {
      // IN_PROGRESS
      console.log(
        `${assetIdAndName} is ${assetMetadata.percentComplete}% complete.`
      );
    }

    // Not done yet, check again in 10 seconds
    setTimeout(waitUntilReady, 10000, assetId);
  }
}

async function main() {
  // Step 1 POST information about the data to /v1/assets
  console.log(`Creating new asset: ${name}`);
  const response = await fetch(`${apiBase}/v1/assets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: name,
      description: "",
      type: "3DTILES",
      options: {
        sourceType: "RASTER_IMAGERY",
        meshQuality: "Medium",
        useGpsInfo: true,
        outputs: {
          cesium3DTiles: true,
          las: true,
          gaussianSplats: true,
        },
      },
    }),
  });

  if (!response.ok || response.status !== 200) {
    console.error("Creating asset failed", await response.text());
    return;
  }
  // See https://cesium.com/learn/ion/rest-api/#operation/postAssets for response object details
  const responseJson = await response.json();
  const assetMetadata = responseJson.assetMetadata;
  const additionalAssets = responseJson.additionalAssets ?? [];

  console.log(`Created ${assetMetadata.id} - ${assetMetadata.name}`);
  for (const additional of additionalAssets) {
    console.log(`Created  ${additional.id} - ${additional.name}`);
  }

  // Step 2 Use uploadLocation to upload the files to ion
  console.log(`Asset created. Uploading ${input}`);
  const uploadLocation = responseJson.uploadLocation;
  const s3Client = new S3Client({
    endpoint: uploadLocation.endpoint,
    region: "us-east-1",
    credentials: {
      accessKeyId: uploadLocation.accessKey,
      secretAccessKey: uploadLocation.secretAccessKey,
      sessionToken: uploadLocation.sessionToken,
    },
  });
  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: uploadLocation.bucket,
      Key: `${uploadLocation.prefix}images.zip`,
      Body: createReadStream(input),
    },
  });
  upload.on("httpUploadProgress", (progress) => {
    const percentage = Math.round((progress.loaded / progress.total) * 100);
    console.log(`Upload progress: ${percentage}%`);
  });
  await upload.done();

  // Step 3 Tell ion we are done uploading files.
  const onComplete = responseJson.onComplete;
  await fetch(onComplete.url, {
    method: onComplete.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(onComplete.fields),
  });

  // Step 4 Monitor the tiling process and report when it is finished.
  const assetIds = [
    assetMetadata.id,
    ...additionalAssets.map((asset) => asset.id),
  ];
  const promises = assetIds.map((id) => waitUntilReady(id));
  await Promise.all(promises);
}

main().catch((e) => {
  console.log(e.message);
});
