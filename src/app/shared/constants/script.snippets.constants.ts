export interface ScriptSnippet { id: string; name: string; description: string; code: string; }

export const DEFAULT_ENCRYPTION_SCRIPT_SKELETON = `async function encryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths) {
    //only code written within this code block will be executed
}`;

export const DEFAULT_DECRYPTION_SCRIPT_SKELETON = `async function decryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths) {
    //only code written within this code block will be executed
}`;

export const DEFAULT_PRE_REQUEST_SCRIPT_SKELETON = `async function preScript(headers, body, params) {
    //only code written within this code block will be executed
}`;

export const DEFAULT_POST_RESPONSE_SCRIPT_SKELETON = `async function postScript(responseHeaders, responseBody, headers, body, params) {
    //only code written within this code block will be executed
}`;

export const DEFAULT_TEST_SCRIPT_SKELETON = `async function testScript(responseStatus, responseTime, responseBody, responseHeaders) {
    //only code written within this code block will be executed
    let passed = true;
    return passed;
}`;

export const PRE_REQUEST_SNIPPETS: ScriptSnippet[] = [
    {
        id: 'log_timestamp',
        name: 'Log Request Timestamp',
        description: 'Log the current timestamp to the console',
        code: `    console.log("Request started at: " + new Date().toISOString());`
    },
    {
        id: 'add_custom_header',
        name: 'Add Custom Header',
        description: 'Add a custom header to the outgoing request',
        code: `    // Add a custom header dynamically
    headers["X-Custom-Header"] = "MyCustomValue";`
    }
];

export const POST_RESPONSE_SNIPPETS: ScriptSnippet[] = [
    {
        id: 'check_200',
        name: 'Check 200 OK',
        description: 'Log if the response status is 200 OK',
        code: `    if (responseHeader && responseHeader.status === 200) {
        console.log("Request was successful (200 OK)");
    } else {
        console.log("Request failed or returned non-200 status");
    }`
    },
    {
        id: 'log_response_body',
        name: 'Log Response Body',
        description: 'Log the raw response body to the console',
        code: `    console.log("Response Body: ", responseBody);`
    }
];
