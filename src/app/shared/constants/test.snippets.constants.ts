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
        code: `    // Assert HTTP status code is 200 (OK)
    if (responseStatus === 200) {
        console.log("PASS: Status code is 200 (OK)");
    } else {
        console.log("FAIL: Expected status code 200, but received " + responseStatus);
        passed = false;
    }`,
        pythonCode: `    # Assert HTTP status code is 200 (OK)
    if response_status == 200:
        print("PASS: Status code is 200 (OK)")
    else:
        print(f"FAIL: Expected status code 200, but received {response_status}")
        passed = False`
    },
    {
        id: 'status_2xx',
        name: 'Status: 2xx Success',
        description: 'Assert that the HTTP status code is in the 2xx success range (200-299)',
        code: `    // Assert HTTP status code is in the 2xx success range
    if (responseStatus >= 200 && responseStatus < 300) {
        console.log("PASS: Status code is successful (" + responseStatus + ")");
    } else {
        console.log("FAIL: Expected 2xx success status code, but received " + responseStatus);
        passed = false;
    }`,
        pythonCode: `    # Assert HTTP status code is in the 2xx success range
    if 200 <= (response_status or 0) < 300:
        print(f"PASS: Status code is successful ({response_status})")
    else:
        print(f"FAIL: Expected 2xx success status code, but received {response_status}")
        passed = False`
    },
    {
        id: 'status_201',
        name: 'Status: 201 Created',
        description: 'Assert that the HTTP response status code equals 201 (Created)',
        code: `    // Assert HTTP status code is 201 (Created)
    if (responseStatus === 201) {
        console.log("PASS: Status code is 201 (Created)");
    } else {
        console.log("FAIL: Expected status code 201, but received " + responseStatus);
        passed = false;
    }`,
        pythonCode: `    # Assert HTTP status code is 201 (Created)
    if response_status == 201:
        print("PASS: Status code is 201 (Created)")
    else:
        print(f"FAIL: Expected status code 201, but received {response_status}")
        passed = False`
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
    }`,
        pythonCode: `    # Assert HTTP status code is a client error (4xx)
    if 400 <= (response_status or 0) < 500:
        print(f"PASS: Received expected client error ({response_status})")
    else:
        print(f"FAIL: Expected 4xx client error, but received {response_status}")
        passed = False`
    },
    {
        id: 'response_time_200',
        name: 'Time: < 200ms',
        description: 'Assert that the total response time is less than 200 milliseconds',
        code: `    // Assert response time is under 200ms
    if (responseTime < 200) {
        console.log("PASS: Response time is " + responseTime + "ms (< 200ms)");
    } else {
        console.log("FAIL: Response time is " + responseTime + "ms (>= 200ms)");
        passed = false;
    }`,
        pythonCode: `    # Assert response time is under 200ms
    if (response_time or 0) < 200:
        print(f"PASS: Response time is {response_time}ms (< 200ms)")
    else:
        print(f"FAIL: Response time is {response_time}ms (>= 200ms)")
        passed = False`
    },
    {
        id: 'response_time_500',
        name: 'Time: < 500ms',
        description: 'Assert that the total response time is less than 500 milliseconds',
        code: `    // Assert response time is under 500ms
    if (responseTime < 500) {
        console.log("PASS: Response time is " + responseTime + "ms (< 500ms)");
    } else {
        console.log("FAIL: Response time is " + responseTime + "ms (>= 500ms)");
        passed = false;
    }`,
        pythonCode: `    # Assert response time is under 500ms
    if (response_time or 0) < 500:
        print(f"PASS: Response time is {response_time}ms (< 500ms)")
    else:
        print(f"FAIL: Response time is {response_time}ms (>= 500ms)")
        passed = False`
    },
    {
        id: 'body_has_key',
        name: 'Body: Has Key',
        description: 'Assert that the JSON response body contains a specific property/key',
        code: `    // Assert response body has expected property
    if (responseBody && typeof responseBody === 'object' && ('data' in responseBody || 'id' in responseBody)) {
        console.log("PASS: Response body contains expected property ('data' or 'id')");
    } else {
        console.log("FAIL: Response body does not contain expected property ('data' or 'id')");
        passed = false;
    }`,
        pythonCode: `    # Assert response body has expected property
    if isinstance(response_body, dict) and ('data' in response_body or 'id' in response_body):
        print("PASS: Response body contains expected property ('data' or 'id')")
    else:
        print("FAIL: Response body does not contain expected property ('data' or 'id')")
        passed = False`
    },
    {
        id: 'body_property_value',
        name: 'Body: Match Value',
        description: 'Assert that a field in the response body matches the expected value',
        code: `    // Assert specific field value in response body
    if (responseBody && (responseBody.success === true || responseBody.status === 'success')) {
        console.log("PASS: Response field check passed");
    } else {
        console.log("FAIL: Response field check failed");
        passed = false;
    }`,
        pythonCode: `    # Assert specific field value in response body
    if isinstance(response_body, dict) and (response_body.get('success') == True or response_body.get('status') == 'success'):
        print("PASS: Response field check passed")
    else:
        print("FAIL: Response field check failed")
        passed = False`
    },
    {
        id: 'body_is_array',
        name: 'Body: Has Array',
        description: 'Assert that the response body is an array containing at least one item',
        code: `    // Assert response body is a non-empty array
    const targetArray = Array.isArray(responseBody) ? responseBody : (responseBody?.data || responseBody?.items);
    if (Array.isArray(targetArray) && targetArray.length > 0) {
        console.log("PASS: Response array contains " + targetArray.length + " items");
    } else {
        console.log("FAIL: Expected non-empty array in response body");
        passed = false;
    }`,
        pythonCode: `    # Assert response body is a non-empty array
    target_array = response_body if isinstance(response_body, list) else (response_body.get('data') or response_body.get('items') if isinstance(response_body, dict) else None)
    if isinstance(target_array, list) and len(target_array) > 0:
        print(f"PASS: Response array contains {len(target_array)} items")
    else:
        print("FAIL: Expected non-empty array in response body")
        passed = False`
    },
    {
        id: 'body_contains_string',
        name: 'Body: Has String',
        description: 'Assert that the raw response body contains a specific substring',
        code: `    // Assert response body contains string
    const rawBodyText = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody || '');
    if (rawBodyText && rawBodyText.includes("success")) {
        console.log("PASS: Response body contains 'success'");
    } else {
        console.log("FAIL: Response body does not contain 'success'");
        passed = false;
    }`,
        pythonCode: `    # Assert response body contains string
    raw_body_text = response_body if isinstance(response_body, str) else json.dumps(response_body or '')
    if raw_body_text and 'success' in raw_body_text:
        print("PASS: Response body contains 'success'")
    else:
        print("FAIL: Response body does not contain 'success'")
        passed = False`
    },
    {
        id: 'header_content_type',
        name: 'Header: JSON Content',
        description: 'Assert that the Content-Type response header includes application/json',
        code: `    // Assert Content-Type header includes application/json
    const contentType = responseHeaders ? (responseHeaders['content-type'] || responseHeaders['Content-Type'] || '') : '';
    if (contentType.toLowerCase().includes('application/json')) {
        console.log("PASS: Content-Type header is JSON (" + contentType + ")");
    } else {
        console.log("FAIL: Content-Type header is not JSON: " + contentType);
        passed = false;
    }`,
        pythonCode: `    # Assert Content-Type header includes application/json
    hdrs = {h.get('key', '').lower(): h.get('value', '') for h in (response_headers or []) if isinstance(h, dict)} if isinstance(response_headers, list) else (response_headers or {})
    content_type = hdrs.get('content-type', '')
    if 'application/json' in str(content_type).lower():
        print(f"PASS: Content-Type header is JSON ({content_type})")
    else:
        print(f"FAIL: Content-Type header is not JSON: {content_type}")
        passed = False`
    },
    {
        id: 'status_204',
        name: 'Status: 204 No Content',
        description: 'Assert that the HTTP response status code equals 204 (No Content)',
        code: `    // Assert HTTP status code is 204 (No Content)
    if (responseStatus === 204) {
        console.log("PASS: Status code is 204 (No Content)");
    } else {
        console.log("FAIL: Expected status code 204, but received " + responseStatus);
        passed = false;
    }`,
        pythonCode: `    # Assert HTTP status code is 204 (No Content)
    if response_status == 204:
        print("PASS: Status code is 204 (No Content)")
    else:
        print(f"FAIL: Expected status code 204, but received {response_status}")
        passed = False`
    },
    {
        id: 'status_400',
        name: 'Status: 400 Bad Request',
        description: 'Assert that the HTTP response status code equals 400 (Bad Request)',
        code: `    // Assert HTTP status code is 400 (Bad Request)
    if (responseStatus === 400) {
        console.log("PASS: Status code is 400 (Bad Request)");
    } else {
        console.log("FAIL: Expected status code 400, but received " + responseStatus);
        passed = false;
    }`,
        pythonCode: `    # Assert HTTP status code is 400 (Bad Request)
    if response_status == 400:
        print("PASS: Status code is 400 (Bad Request)")
    else:
        print(f"FAIL: Expected status code 400, but received {response_status}")
        passed = False`
    },
    {
        id: 'status_401',
        name: 'Status: 401 Unauthorized',
        description: 'Assert that the HTTP response status code equals 401 (Unauthorized)',
        code: `    // Assert HTTP status code is 401 (Unauthorized)
    if (responseStatus === 401) {
        console.log("PASS: Status code is 401 (Unauthorized)");
    } else {
        console.log("FAIL: Expected status code 401, but received " + responseStatus);
        passed = false;
    }`,
        pythonCode: `    # Assert HTTP status code is 401 (Unauthorized)
    if response_status == 401:
        print("PASS: Status code is 401 (Unauthorized)")
    else:
        print(f"FAIL: Expected status code 401, but received {response_status}")
        passed = False`
    },
    {
        id: 'status_404',
        name: 'Status: 404 Not Found',
        description: 'Assert that the HTTP response status code equals 404 (Not Found)',
        code: `    // Assert HTTP status code is 404 (Not Found)
    if (responseStatus === 404) {
        console.log("PASS: Status code is 404 (Not Found)");
    } else {
        console.log("FAIL: Expected status code 404, but received " + responseStatus);
        passed = false;
    }`,
        pythonCode: `    # Assert HTTP status code is 404 (Not Found)
    if response_status == 404:
        print("PASS: Status code is 404 (Not Found)")
    else:
        print(f"FAIL: Expected status code 404, but received {response_status}")
        passed = False`
    },
    {
        id: 'status_5xx',
        name: 'Status: 5xx Error',
        description: 'Assert that the HTTP status code is in the 5xx server error range',
        code: `    // Assert HTTP status code is a server error (5xx)
    if (responseStatus >= 500 && responseStatus < 600) {
        console.log("PASS: Received server error status (" + responseStatus + ")");
    } else {
        console.log("FAIL: Expected 5xx server error, but received " + responseStatus);
        passed = false;
    }`,
        pythonCode: `    # Assert HTTP status code is a server error (5xx)
    if 500 <= (response_status or 0) < 600:
        print(f"PASS: Received server error status ({response_status})")
    else:
        print(f"FAIL: Expected 5xx server error, but received {response_status}")
        passed = False`
    },
    {
        id: 'response_time_1000',
        name: 'Time: < 1000ms',
        description: 'Assert that the total response time is less than 1 second (1000ms)',
        code: `    // Assert response time is under 1000ms
    if (responseTime < 1000) {
        console.log("PASS: Response time is " + responseTime + "ms (< 1000ms)");
    } else {
        console.log("FAIL: Response time is " + responseTime + "ms (>= 1000ms)");
        passed = false;
    }`,
        pythonCode: `    # Assert response time is under 1000ms
    if (response_time or 0) < 1000:
        print(f"PASS: Response time is {response_time}ms (< 1000ms)")
    else:
        print(f"FAIL: Response time is {response_time}ms (>= 1000ms)")
        passed = False`
    },
    {
        id: 'body_nested_property',
        name: 'Body: Nested Key',
        description: 'Assert that a nested property exists in the JSON response (e.g. data.token or data.id)',
        code: `    // Assert nested property exists
    const token = responseBody?.data?.token || responseBody?.token || responseBody?.accessToken;
    if (token) {
        console.log("PASS: Auth token property exists in response");
    } else {
        console.log("FAIL: Auth token property missing in response");
        passed = false;
    }`,
        pythonCode: `    # Assert nested property exists
    nested_data = response_body.get('data') if isinstance(response_body, dict) else None
    token = (nested_data.get('token') if isinstance(nested_data, dict) else None) or (response_body.get('token') if isinstance(response_body, dict) else None) or (response_body.get('accessToken') if isinstance(response_body, dict) else None)
    if token:
        print("PASS: Auth token property exists in response")
    else:
        print("FAIL: Auth token property missing in response")
        passed = False`
    },
    {
        id: 'header_presence',
        name: 'Header: Has Header',
        description: 'Assert that a specific header exists in the response',
        code: `    // Assert specific header is present in response
    const hasHeader = responseHeaders && Object.keys(responseHeaders).some(h => h.toLowerCase() === 'content-type' || h.toLowerCase() === 'server');
    if (hasHeader) {
        console.log("PASS: Expected header is present in response");
    } else {
        console.log("FAIL: Expected header not found in response headers");
        passed = false;
    }`,
        pythonCode: `    # Assert specific header is present in response
    has_header = any((h.get('key', '').lower() in ('content-type', 'server')) for h in (response_headers or []) if isinstance(h, dict)) if isinstance(response_headers, list) else ('content-type' in (response_headers or {}))
    if has_header:
        print("PASS: Expected header is present in response")
    else:
        print("FAIL: Expected header not found in response headers")
        passed = False`
    }
];
