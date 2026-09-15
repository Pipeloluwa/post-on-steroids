export interface ScriptSnippet { id: string; name: string; description: string; code: string; }

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
