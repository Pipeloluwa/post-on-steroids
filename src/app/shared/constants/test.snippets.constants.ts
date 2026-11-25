export interface TestSnippet {
    id: string;
    name: string;
    description: string;
    code: string;
    pythonCode?: string;
}

export const STANDARD_TEST_SNIPPETS: TestSnippet[] = [
    {
        id: 'status_200',
        name: 'Status: 200 OK',
        description: 'Assert that the HTTP response status code equals 200 (OK)',
        code: `st.test('Status code is 200 (OK)', () => {
    st.expect(st.responseStatus).to.equal(200);
});`,
        pythonCode: `if response_status == 200:
    print("PASS: Status code is 200 (OK)")
else:
    print(f"FAIL: Expected status code 200, but received {response_status}")`
    },
    {
        id: 'status_2xx',
        name: 'Status: 2xx Success',
        description: 'Assert that the HTTP status code is in the 2xx success range (200-299)',
        code: `st.test('Status code is 2xx Success', () => {
    st.expect(st.responseStatus).to.be.above(199);
    st.expect(st.responseStatus).to.be.below(300);
});`,
        pythonCode: `if 200 <= (response_status or 0) < 300:
    print(f"PASS: Status code is successful ({response_status})")
else:
    print(f"FAIL: Expected 2xx success status code, but received {response_status}")`
    },
    {
        id: 'status_201',
        name: 'Status: 201 Created',
        description: 'Assert that the HTTP response status code equals 201 (Created)',
        code: `st.test('Status code is 201 (Created)', () => {
    st.expect(st.responseStatus).to.equal(201);
});`,
        pythonCode: `if response_status == 201:
    print("PASS: Status code is 201 (Created)")
else:
    print(f"FAIL: Expected status code 201, but received {response_status}")`
    },
    {
        id: 'status_4xx',
        name: 'Status code: Client error (4xx)',
        description: 'Assert that the HTTP status code is an expected client error (400-499)',
        code: `st.test('Status code is client error (4xx)', () => {
    st.expect(st.responseStatus).to.be.above(399);
    st.expect(st.responseStatus).to.be.below(500);
});`,
        pythonCode: `if 400 <= (response_status or 0) < 500:
    print(f"PASS: Received expected client error ({response_status})")
else:
    print(f"FAIL: Expected 4xx client error, but received {response_status}")`
    },
    {
        id: 'response_time_200',
        name: 'Time: < 200ms',
        description: 'Assert that the total response time is less than 200 milliseconds',
        code: `st.test('Response time is < 200ms', () => {
    st.expect(st.responseTime).to.be.below(200);
});`,
        pythonCode: `if (response_time or 0) < 200:
    print(f"PASS: Response time is {response_time}ms (< 200ms)")
else:
    print(f"FAIL: Response time is {response_time}ms (>= 200ms)")`
    },
    {
        id: 'response_time_500',
        name: 'Time: < 500ms',
        description: 'Assert that the total response time is less than 500 milliseconds',
        code: `st.test('Response time is < 500ms', () => {
    st.expect(st.responseTime).to.be.below(500);
});`,
        pythonCode: `if (response_time or 0) < 500:
    print(f"PASS: Response time is {response_time}ms (< 500ms)")
else:
    print(f"FAIL: Response time is {response_time}ms (>= 500ms)")`
    },
    {
        id: 'body_has_key',
        name: 'Body: Has Key',
        description: 'Assert that the JSON response body contains a specific property/key',
        code: `st.test("Response body contains 'data' or 'id'", () => {
    const body = st.responseBody;
    st.expect(Boolean(body && typeof body === 'object' && ('data' in body || 'id' in body))).to.equal(true);
});`,
        pythonCode: `if isinstance(response_body, dict) and ('data' in response_body or 'id' in response_body):
    print("PASS: Response body contains expected property ('data' or 'id')")
else:
    print("FAIL: Response body does not contain expected property ('data' or 'id')")`
    },
    {
        id: 'body_property_value',
        name: 'Body: Match Value',
        description: 'Assert that a field in the response body matches the expected value',
        code: `st.test('Response field matches expected value', () => {
    const body = st.responseBody;
    st.expect(Boolean(body && (body.success === true || body.status === 'success'))).to.equal(true);
});`,
        pythonCode: `if isinstance(response_body, dict) and (response_body.get('success') == True or response_body.get('status') == 'success'):
    print("PASS: Response field check passed")
else:
    print("FAIL: Response field check failed")`
    },
    {
        id: 'body_is_array',
        name: 'Body: Has Array',
        description: 'Assert that the response body is an array containing at least one item',
        code: `st.test('Response body contains non-empty array', () => {
    const targetArray = Array.isArray(st.responseBody)
        ? st.responseBody
        : (st.responseBody?.data || st.responseBody?.items);
    st.expect(Array.isArray(targetArray) && targetArray.length > 0).to.equal(true);
});`,
        pythonCode: `target_array = response_body if isinstance(response_body, list) else (response_body.get('data') or response_body.get('items') if isinstance(response_body, dict) else None)
if isinstance(target_array, list) and len(target_array) > 0:
    print(f"PASS: Response array contains {len(target_array)} items")
else:
    print("FAIL: Expected non-empty array in response body")`
    },
    {
        id: 'body_contains_string',
        name: 'Body: Has String',
        description: 'Assert that the raw response body contains a specific substring',
        code: `st.test("Response body includes 'success'", () => {
    const rawBodyText = typeof st.responseBody === 'string' ? st.responseBody : JSON.stringify(st.responseBody || '');
    st.expect(rawBodyText).to.include('success');
});`,
        pythonCode: `raw_body_text = response_body if isinstance(response_body, str) else json.dumps(response_body or '')
if raw_body_text and 'success' in raw_body_text:
    print("PASS: Response body contains 'success'")
else:
    print("FAIL: Response body does not contain 'success'")`
    },
    {
        id: 'header_content_type',
        name: 'Header: JSON Content',
        description: 'Assert that the Content-Type response header includes application/json',
        code: `st.test('Content-Type header is JSON', () => {
    const headers = st.responseHeaders || {};
    const contentType = headers['content-type'] || headers['Content-Type'] || '';
    st.expect(String(contentType).toLowerCase()).to.include('application/json');
});`,
        pythonCode: `hdrs = {h.get('key', '').lower(): h.get('value', '') for h in (response_headers or []) if isinstance(h, dict)} if isinstance(response_headers, list) else (response_headers or {})
content_type = hdrs.get('content-type', '')
if 'application/json' in str(content_type).lower():
    print(f"PASS: Content-Type header is JSON ({content_type})")
else:
    print(f"FAIL: Content-Type header is not JSON: {content_type}")`
    },
    {
        id: 'status_204',
        name: 'Status: 204 No Content',
        description: 'Assert that the HTTP response status code equals 204 (No Content)',
        code: `st.test('Status code is 204 (No Content)', () => {
    st.expect(st.responseStatus).to.equal(204);
});`,
        pythonCode: `if response_status == 204:
    print("PASS: Status code is 204 (No Content)")
else:
    print(f"FAIL: Expected status code 204, but received {response_status}")`
    },
    {
        id: 'status_400',
        name: 'Status: 400 Bad Request',
        description: 'Assert that the HTTP response status code equals 400 (Bad Request)',
        code: `st.test('Status code is 400 (Bad Request)', () => {
    st.expect(st.responseStatus).to.equal(400);
});`,
        pythonCode: `if response_status == 400:
    print("PASS: Status code is 400 (Bad Request)")
else:
    print(f"FAIL: Expected status code 400, but received {response_status}")`
    },
    {
        id: 'status_401',
        name: 'Status: 401 Unauthorized',
        description: 'Assert that the HTTP response status code equals 401 (Unauthorized)',
        code: `st.test('Status code is 401 (Unauthorized)', () => {
    st.expect(st.responseStatus).to.equal(401);
});`,
        pythonCode: `if response_status == 401:
    print("PASS: Status code is 401 (Unauthorized)")
else:
    print(f"FAIL: Expected status code 401, but received {response_status}")`
    },
    {
        id: 'status_404',
        name: 'Status: 404 Not Found',
        description: 'Assert that the HTTP response status code equals 404 (Not Found)',
        code: `st.test('Status code is 404 (Not Found)', () => {
    st.expect(st.responseStatus).to.equal(404);
});`,
        pythonCode: `if response_status == 404:
    print("PASS: Status code is 404 (Not Found)")
else:
    print(f"FAIL: Expected status code 404, but received {response_status}")`
    },
    {
        id: 'status_5xx',
        name: 'Status: 5xx Error',
        description: 'Assert that the HTTP status code is in the 5xx server error range',
        code: `st.test('Status code is server error (5xx)', () => {
    st.expect(st.responseStatus).to.be.above(499);
    st.expect(st.responseStatus).to.be.below(600);
});`,
        pythonCode: `if 500 <= (response_status or 0) < 600:
    print(f"PASS: Received server error status ({response_status})")
else:
    print(f"FAIL: Expected 5xx server error, but received {response_status}")`
    },
    {
        id: 'response_time_1000',
        name: 'Time: < 1000ms',
        description: 'Assert that the total response time is less than 1 second (1000ms)',
        code: `st.test('Response time is < 1000ms', () => {
    st.expect(st.responseTime).to.be.below(1000);
});`,
        pythonCode: `if (response_time or 0) < 1000:
    print(f"PASS: Response time is {response_time}ms (< 1000ms)")
else:
    print(f"FAIL: Response time is {response_time}ms (>= 1000ms)")`
    },
    {
        id: 'body_nested_property',
        name: 'Body: Nested Key',
        description: 'Assert that a nested property exists in the JSON response (e.g. data.token or data.id)',
        code: `st.test('Response contains nested auth token property', () => {
    const token = st.responseBody?.data?.token || st.responseBody?.token || st.responseBody?.accessToken;
    st.expect(Boolean(token)).to.equal(true);
});`,
        pythonCode: `nested_data = response_body.get('data') if isinstance(response_body, dict) else None
token = (nested_data.get('token') if isinstance(nested_data, dict) else None) or (response_body.get('token') if isinstance(response_body, dict) else None) or (response_body.get('accessToken') if isinstance(response_body, dict) else None)
if token:
    print("PASS: Auth token property exists in response")
else:
    print("FAIL: Auth token property missing in response")`
    },
    {
        id: 'header_presence',
        name: 'Header: Has Header',
        description: 'Assert that a specific header exists in the response',
        code: `st.test('Expected header is present in response', () => {
    const headers = st.responseHeaders || {};
    const hasHeader = Object.keys(headers).some(h => {
        const lower = h.toLowerCase();
        return lower === 'content-type' || lower === 'server';
    });
    st.expect(hasHeader).to.equal(true);
});`,
        pythonCode: `has_header = any((h.get('key', '').lower() in ('content-type', 'server')) for h in (response_headers or []) if isinstance(h, dict)) if isinstance(response_headers, list) else ('content-type' in (response_headers or {}))
if has_header:
    print("PASS: Expected header is present in response")
else:
    print("FAIL: Expected header not found in response headers")`
    }
];
