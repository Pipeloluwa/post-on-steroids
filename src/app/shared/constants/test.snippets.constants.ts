export interface TestSnippet {
    id: string;
    name: string;
    description: string;
    code: string;
}

export const STANDARD_TEST_SNIPPETS: TestSnippet[] = [
    {
        id: 'status_200',
        name: 'Status code: Code is 200',
        description: 'Assert that the HTTP response status code equals 200 (OK)',
        code: `    // Assert HTTP status code is 200 (OK)
    if (responseStatus === 200) {
        console.log("PASS: Status code is 200 (OK)");
    } else {
        console.log("FAIL: Expected status code 200, but received " + responseStatus);
        passed = false;
    }`
    },
    {
        id: 'status_2xx',
        name: 'Status code: Successful 2xx',
        description: 'Assert that the HTTP status code is in the 2xx success range (200-299)',
        code: `    // Assert HTTP status code is in the 2xx success range
    if (responseStatus >= 200 && responseStatus < 300) {
        console.log("PASS: Status code is successful (" + responseStatus + ")");
    } else {
        console.log("FAIL: Expected 2xx success status code, but received " + responseStatus);
        passed = false;
    }`
    },
    {
        id: 'status_201',
        name: 'Status code: Code is 201 Created',
        description: 'Assert that the HTTP response status code equals 201 (Created)',
        code: `    // Assert HTTP status code is 201 (Created)
    if (responseStatus === 201) {
        console.log("PASS: Status code is 201 (Created)");
    } else {
        console.log("FAIL: Expected status code 201, but received " + responseStatus);
        passed = false;
    }`
    },
    {
        id: 'status_4xx',
        name: 'Status code: Client error (4xx)',
        description: 'Assert that the HTTP status code is an expected client error (400-499)',
        code: `    // Assert HTTP status code is a client error (4xx)
    if (responseStatus >= 400 && responseStatus < 500) {
        console.log("PASS: Received expected client error (" + responseStatus + ")");
    } else {
        console.log("FAIL: Expected 4xx client error, but received " + responseStatus);
        passed = false;
    }`
    },
    {
        id: 'response_time_200',
        name: 'Response time: Under 200ms',
        description: 'Assert that the total response time is less than 200 milliseconds',
        code: `    // Assert response time is under 200ms
    if (responseTime < 200) {
        console.log("PASS: Response time is " + responseTime + "ms (< 200ms)");
    } else {
        console.log("FAIL: Response time is " + responseTime + "ms (>= 200ms)");
        passed = false;
    }`
    },
    {
        id: 'response_time_500',
        name: 'Response time: Under 500ms',
        description: 'Assert that the total response time is less than 500 milliseconds',
        code: `    // Assert response time is under 500ms
    if (responseTime < 500) {
        console.log("PASS: Response time is " + responseTime + "ms (< 500ms)");
    } else {
        console.log("FAIL: Response time is " + responseTime + "ms (>= 500ms)");
        passed = false;
    }`
    },
    {
        id: 'body_has_key',
        name: 'Body: Contains expected property',
        description: 'Assert that the JSON response body contains a specific property/key',
        code: `    // Assert response body has expected property
    if (responseBody && typeof responseBody === 'object' && ('data' in responseBody || 'id' in responseBody)) {
        console.log("PASS: Response body contains expected property ('data' or 'id')");
    } else {
        console.log("FAIL: Response body does not contain expected property ('data' or 'id')");
        passed = false;
    }`
    },
    {
        id: 'body_property_value',
        name: 'Body: Check field value',
        description: 'Assert that a field in the response body matches the expected value',
        code: `    // Assert specific field value in response body
    if (responseBody && (responseBody.success === true || responseBody.status === 'success')) {
        console.log("PASS: Response field check passed");
    } else {
        console.log("FAIL: Response field check failed");
        passed = false;
    }`
    },
    {
        id: 'body_is_array',
        name: 'Body: Is non-empty Array',
        description: 'Assert that the response body is an array containing at least one item',
        code: `    // Assert response body is a non-empty array
    const targetArray = Array.isArray(responseBody) ? responseBody : (responseBody?.data || responseBody?.items);
    if (Array.isArray(targetArray) && targetArray.length > 0) {
        console.log("PASS: Response array contains " + targetArray.length + " items");
    } else {
        console.log("FAIL: Expected non-empty array in response body");
        passed = false;
    }`
    },
    {
        id: 'body_contains_string',
        name: 'Body: Contains string',
        description: 'Assert that the raw response body contains a specific substring',
        code: `    // Assert response body contains string
    const rawBodyText = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody || '');
    if (rawBodyText && rawBodyText.includes("success")) {
        console.log("PASS: Response body contains 'success'");
    } else {
        console.log("FAIL: Response body does not contain 'success'");
        passed = false;
    }`
    },
    {
        id: 'header_content_type',
        name: 'Header: Content-Type is JSON',
        description: 'Assert that the Content-Type response header includes application/json',
        code: `    // Assert Content-Type header includes application/json
    const contentType = responseHeaders ? (responseHeaders['content-type'] || responseHeaders['Content-Type'] || '') : '';
    if (contentType.toLowerCase().includes('application/json')) {
        console.log("PASS: Content-Type header is JSON (" + contentType + ")");
    } else {
        console.log("FAIL: Content-Type header is not JSON: " + contentType);
        passed = false;
    }`
    },
    {
        id: 'status_204',
        name: 'Status code: Code is 204 No Content',
        description: 'Assert that the HTTP response status code equals 204 (No Content)',
        code: `    // Assert HTTP status code is 204 (No Content)
    if (responseStatus === 204) {
        console.log("PASS: Status code is 204 (No Content)");
    } else {
        console.log("FAIL: Expected status code 204, but received " + responseStatus);
        passed = false;
    }`
    },
    {
        id: 'status_400',
        name: 'Status code: Code is 400 Bad Request',
        description: 'Assert that the HTTP response status code equals 400 (Bad Request)',
        code: `    // Assert HTTP status code is 400 (Bad Request)
    if (responseStatus === 400) {
        console.log("PASS: Status code is 400 (Bad Request)");
    } else {
        console.log("FAIL: Expected status code 400, but received " + responseStatus);
        passed = false;
    }`
    },
    {
        id: 'status_401',
        name: 'Status code: Code is 401 Unauthorized',
        description: 'Assert that the HTTP response status code equals 401 (Unauthorized)',
        code: `    // Assert HTTP status code is 401 (Unauthorized)
    if (responseStatus === 401) {
        console.log("PASS: Status code is 401 (Unauthorized)");
    } else {
        console.log("FAIL: Expected status code 401, but received " + responseStatus);
        passed = false;
    }`
    },
    {
        id: 'status_404',
        name: 'Status code: Code is 404 Not Found',
        description: 'Assert that the HTTP response status code equals 404 (Not Found)',
        code: `    // Assert HTTP status code is 404 (Not Found)
    if (responseStatus === 404) {
        console.log("PASS: Status code is 404 (Not Found)");
    } else {
        console.log("FAIL: Expected status code 404, but received " + responseStatus);
        passed = false;
    }`
    },
    {
        id: 'status_5xx',
        name: 'Status code: Server error (5xx)',
        description: 'Assert that the HTTP status code is in the 5xx server error range',
        code: `    // Assert HTTP status code is a server error (5xx)
    if (responseStatus >= 500 && responseStatus < 600) {
        console.log("PASS: Received server error status (" + responseStatus + ")");
    } else {
        console.log("FAIL: Expected 5xx server error, but received " + responseStatus);
        passed = false;
    }`
    },
    {
        id: 'response_time_1000',
        name: 'Response time: Under 1000ms',
        description: 'Assert that the total response time is less than 1 second (1000ms)',
        code: `    // Assert response time is under 1000ms
    if (responseTime < 1000) {
        console.log("PASS: Response time is " + responseTime + "ms (< 1000ms)");
    } else {
        console.log("FAIL: Response time is " + responseTime + "ms (>= 1000ms)");
        passed = false;
    }`
    },
    {
        id: 'body_nested_property',
        name: 'Body: Check nested property (data.token)',
        description: 'Assert that a nested property exists in the JSON response (e.g. data.token or data.id)',
        code: `    // Assert nested property exists
    const token = responseBody?.data?.token || responseBody?.token || responseBody?.accessToken;
    if (token) {
        console.log("PASS: Auth token property exists in response");
    } else {
        console.log("FAIL: Auth token property missing in response");
        passed = false;
    }`
    },
    {
        id: 'header_presence',
        name: 'Header: Header presence check',
        description: 'Assert that a specific header exists in the response',
        code: `    // Assert specific header is present in response
    const hasHeader = responseHeaders && Object.keys(responseHeaders).some(h => h.toLowerCase() === 'content-type' || h.toLowerCase() === 'server');
    if (hasHeader) {
        console.log("PASS: Expected header is present in response");
    } else {
        console.log("FAIL: Expected header not found in response headers");
        passed = false;
    }`
    }
];
