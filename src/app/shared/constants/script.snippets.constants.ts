export type ScriptLanguage = 'javascript' | 'python';

export interface DefaultScriptEntry {
    name: string;
    code: string;
    pythonCode?: string;
}

export interface ScriptSnippet {
    id: string;
    name: string;
    description: string;
    code: string;
    pythonCode?: string;
}

export const DEFAULT_ENCRYPTION_SCRIPTS: DefaultScriptEntry[] = [
    {
        name: 'Encrypt',
        code: `// Top-level imports are supported above this function (e.g. import CryptoJS from 'crypto-js';)
// Available parameters (headers, body, params, encryptedHeaders, encryptedBodyPaths, ...) can also be accessed via st.* (type "st." for autocomplete)
async function encryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths, bodyType, rawType, formData, encryptedFormData, urlEncodedData, encryptedUrlEncodedData, graphql, encryptedGraphqlPaths, rawText, encryptRawText) {
    // Only code within this block (and top-level imports above) will be executed
}`,
        pythonCode: `# Top-level imports are supported above this function (e.g. import hashlib, json)
# Available parameters can also be accessed via st.* or snake_case helpers
async def encrypt_script(headers, body, params, encrypted_headers, encrypted_body_paths, body_type, raw_type, form_data, encrypted_form_data, url_encoded_data, encrypted_url_encoded_data, graphql, encrypted_graphql_paths, raw_text, encrypt_raw_text):
    # Only code within this block (and imports above) will be executed
    pass`
    },
    {
        name: 'Encrypt (Base64 Sample)',
        code: `async function encryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths, bodyType, rawType, formData, encryptedFormData, urlEncodedData, encryptedUrlEncodedData, graphql, encryptedGraphqlPaths, rawText, encryptRawText) {
    // Encode targeted headers and top-level body fields using Base64 as a starter template
    for (const h of headers || []) {
        if (h.enabled && (encryptedHeaders || []).includes(h.key)) {
            h.value = btoa(String(h.value ?? ''));
        }
    }
    if (body && typeof body === 'object' && !Array.isArray(body)) {
        for (const path of encryptedBodyPaths || []) {
            if (Object.prototype.hasOwnProperty.call(body, path) && typeof body[path] !== 'object') {
                body[path] = btoa(String(body[path] ?? ''));
            }
        }
    }
    return body;
}`,
        pythonCode: `import base64

async def encrypt_script(headers, body, params, encrypted_headers, encrypted_body_paths, body_type, raw_type, form_data, encrypted_form_data, url_encoded_data, encrypted_url_encoded_data, graphql, encrypted_graphql_paths, raw_text, encrypt_raw_text):
    # Encode targeted headers and top-level body fields using Base64 as a starter template
    for h in headers or []:
        if h.get('enabled') and h.get('key') in (encrypted_headers or []):
            h['value'] = base64.b64encode(str(h.get('value', '')))
    if isinstance(body, dict):
        for path in encrypted_body_paths or []:
            if path in body and not isinstance(body[path], (dict, list)):
                body[path] = base64.b64encode(str(body[path]))
    return body`
    }
];

export const DEFAULT_DECRYPTION_SCRIPTS: DefaultScriptEntry[] = [
    {
        name: 'Decrypt',
        code: `// Top-level imports are supported above this function (e.g. import CryptoJS from 'crypto-js';)
// Available parameters (headers, body, params, encryptedHeaders, encryptedBodyPaths, ...) can also be accessed via st.* (type "st." for autocomplete)
async function decryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths, bodyType, rawType, formData, encryptedFormData, urlEncodedData, encryptedUrlEncodedData, graphql, encryptedGraphqlPaths, rawText, encryptRawText) {
    // Only code within this block (and top-level imports above) will be executed
}`,
        pythonCode: `# Top-level imports are supported above this function (e.g. import base64, json)
async def decrypt_script(headers, body, params, encrypted_headers, encrypted_body_paths, body_type, raw_type, form_data, encrypted_form_data, url_encoded_data, encrypted_url_encoded_data, graphql, encrypted_graphql_paths, raw_text, encrypt_raw_text):
    # Only code within this block (and imports above) will be executed
    pass`
    },
    {
        name: 'Decrypt (Base64 Sample)',
        code: `async function decryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths, bodyType, rawType, formData, encryptedFormData, urlEncodedData, encryptedUrlEncodedData, graphql, encryptedGraphqlPaths, rawText, encryptRawText) {
    // Decode targeted Base64 headers and top-level body fields as a starter template
    for (const h of headers || []) {
        if (h.enabled && (encryptedHeaders || []).includes(h.key) && h.value) {
            try { h.value = atob(String(h.value)); } catch {}
        }
    }
    if (body && typeof body === 'object' && !Array.isArray(body)) {
        for (const path of encryptedBodyPaths || []) {
            if (typeof body[path] === 'string') {
                try { body[path] = atob(body[path]); } catch {}
            }
        }
    }
    return body;
}`,
        pythonCode: `import base64

async def decrypt_script(headers, body, params, encrypted_headers, encrypted_body_paths, body_type, raw_type, form_data, encrypted_form_data, url_encoded_data, encrypted_url_encoded_data, graphql, encrypted_graphql_paths, raw_text, encrypt_raw_text):
    # Decode targeted Base64 headers and top-level body fields as a starter template
    for h in headers or []:
        if h.get('enabled') and h.get('key') in (encrypted_headers or []) and h.get('value'):
            try:
                h['value'] = base64.b64decode(str(h['value']))
            except Exception:
                pass
    if isinstance(body, dict):
        for path in encrypted_body_paths or []:
            if isinstance(body.get(path), str):
                try:
                    body[path] = base64.b64decode(body[path])
                except Exception:
                    pass
    return body`
    }
];

export const DEFAULT_PRE_REQUEST_SCRIPTS: DefaultScriptEntry[] = [
    {
        name: 'Pre-request',
        code: `// Top-level imports are supported above this function (e.g. import CryptoJS from 'crypto-js';)
// Request parameters (headers, body, params, ...) & helpers can also be accessed via st.* (type "st." for autocomplete)
async function preScript(headers, body, params, bodyType, rawType, formData, urlEncodedData, graphql, rawText) {
    // Write your pre-request logic here
}`,
        pythonCode: `# Top-level imports are supported above this function (e.g. import uuid, time, json)
# Request parameters & helpers can also be accessed via st.* or set_header/set_body_field/set_env
async def pre_script(headers, body, params, body_type, raw_type, form_data, url_encoded_data, graphql, raw_text):
    # Write your pre-request logic here
    pass`
    },
    {
        name: 'Pre-request (Dynamic Headers & Params)',
        code: `async function preScript(headers, body, params, bodyType, rawType, formData, urlEncodedData, graphql, rawText) {
    // Inject correlation ID and timestamp directly into outgoing request headers & query params
    const requestId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
    setHeader('X-Correlation-ID', requestId);
    setQuery('timestamp', String(Date.now()));
    console.log('Prepared request with X-Correlation-ID:', requestId);
}`,
        pythonCode: `import uuid
import time

async def pre_script(headers, body, params, body_type, raw_type, form_data, url_encoded_data, graphql, raw_text):
    # Inject correlation ID and timestamp directly into outgoing request headers & query params
    request_id = str(uuid.uuid4())
    set_header('X-Correlation-ID', request_id)
    set_query('timestamp', str(int(time.time() * 1000)))
    print(f'Prepared request with X-Correlation-ID: {request_id}')`
    },
    {
        name: 'Pre-request (Fetch Token & Populate Request)',
        code: `async function preScript(headers, body, params, bodyType, rawType, formData, urlEncodedData, graphql, rawText) {
    // Fetch data dynamically before sending and link values straight into request headers/body/params
    const authUrl = getEnv('authUrl') || '';
    if (!authUrl) {
        console.log('Set env var "authUrl" to auto-fetch a token before sending.');
        return;
    }
    const res = await fetch(authUrl, { method: 'GET' });
    const data = await res.json();
    const token = data?.token || data?.access_token;
    if (token) {
        setHeader('Authorization', 'Bearer ' + token);
        setBodyField('meta.sessionToken', token);
        setEnv('lastToken', token);
    }
}`,
        pythonCode: `import requests

async def pre_script(headers, body, params, body_type, raw_type, form_data, url_encoded_data, graphql, raw_text):
    # Fetch data dynamically before sending and link values straight into request headers/body/params
    auth_url = get_env('authUrl') or ''
    if not auth_url:
        print('Set env var "authUrl" to auto-fetch a token before sending.')
        return
    res = await requests.get(auth_url)
    data = res.json()
    token = data.get('token') or data.get('access_token')
    if token:
        set_header('Authorization', f'Bearer {token}')
        set_body_field('meta.sessionToken', token)
        set_env('lastToken', token)`
    }
];

export const DEFAULT_POST_RESPONSE_SCRIPTS: DefaultScriptEntry[] = [
    {
        name: 'Post-response',
        code: `// Top-level imports are supported above this function across all script types
// Response/request parameters (responseHeaders, responseBody, headers, body, ...) can be accessed directly or via st.* (type "st." for autocomplete)
async function postScript(responseHeaders, responseBody, headers, body, params, bodyType, rawType, formData, urlEncodedData, graphql, rawText) {
    // Write your post-response logic here
}`,
        pythonCode: `# Top-level imports are supported above this function across all script types
# Response/request parameters & st.* helpers are available directly inside this function
async def post_script(response_headers, response_body, headers, body, params, body_type, raw_type, form_data, url_encoded_data, graphql, raw_text):
    # Write your post-response logic here
    pass`
    },
    {
        name: 'Post-response (Link Response to Request Fields)',
        code: `async function postScript(responseHeaders, responseBody, headers, body, params, bodyType, rawType, formData, urlEncodedData, graphql, rawText) {
    // Extract fields from responseBody and link them directly into request params, headers, query, or body
    if (responseBody && typeof responseBody === 'object') {
        const token = responseBody?.token || responseBody?.data?.token;
        if (token) {
            setHeader('X-Session-Token', token);
            setBodyField('token', token);
            setEnv('authToken', token);
            console.log('Linked response token to request header & body.');
        }
    }
}`,
        pythonCode: `async def post_script(response_headers, response_body, headers, body, params, body_type, raw_type, form_data, url_encoded_data, graphql, raw_text):
    # Extract fields from response_body and link them directly into request params, headers, query, or body
    if isinstance(response_body, dict):
        data = response_body.get('data') or {}
        token = response_body.get('token') or (data.get('token') if isinstance(data, dict) else None)
        if token:
            set_header('X-Session-Token', token)
            set_body_field('token', token)
            set_env('authToken', token)
            print('Linked response token to request header & body.')`
    }
];

export const DEFAULT_TEST_SCRIPTS: DefaultScriptEntry[] = [
    {
        name: 'Test',
        code: `// Top-level imports are supported above this function (e.g. import Ajv from 'ajv';)
// Access test assertions, response & parameters directly or via st.* (type "st." for autocomplete, e.g. st.test / st.expect)
async function testScript(responseStatus, responseTime, responseBody, responseHeaders, headers, body, params, bodyType, rawType, formData, urlEncodedData, graphql, rawText) {
    let passed = true;
    return passed;
}`,
        pythonCode: `# Top-level imports are supported above this function
# Return True/False or call st.test(...) / test(...) assertions
async def test_script(response_status, response_time, response_body, response_headers, headers, body, params, body_type, raw_type, form_data, url_encoded_data, graphql, raw_text):
    passed = True
    return passed`
    },
    {
        name: 'Test (Status, Latency & Schema)',
        code: `async function testScript(responseStatus, responseTime, responseBody, responseHeaders, headers, body, params, bodyType, rawType, formData, urlEncodedData, graphql, rawText) {
    let passed = true;
    test('Status code is 2xx', () => {
        expect(responseStatus).to.be.above(199);
        expect(responseStatus).to.be.below(300);
    });
    test('Response time < 2000ms', () => {
        expect(responseTime).to.be.below(2000);
    });
    test('Response body is present', () => {
        expect(responseBody).to.not.be.null;
    });
    return passed;
}`,
        pythonCode: `async def test_script(response_status, response_time, response_body, response_headers, headers, body, params, body_type, raw_type, form_data, url_encoded_data, graphql, raw_text):
    passed = True
    if 200 <= (response_status or 0) < 300:
        print('PASS: Status code is 2xx')
    else:
        print(f'FAIL: Expected 2xx status, got {response_status}')
        passed = False
    if (response_time or 0) < 2000:
        print('PASS: Response time < 2000ms')
    else:
        print(f'FAIL: Slow response {response_time}ms')
        passed = False
    if response_body is not None:
        print('PASS: Response body is present')
    else:
        print('FAIL: Response body is empty')
        passed = False
    return passed`
    }
];

export const DEFAULT_ENCRYPTION_SCRIPT_SKELETON = DEFAULT_ENCRYPTION_SCRIPTS[0].code;
export const DEFAULT_DECRYPTION_SCRIPT_SKELETON = DEFAULT_DECRYPTION_SCRIPTS[0].code;
export const DEFAULT_PRE_REQUEST_SCRIPT_SKELETON = DEFAULT_PRE_REQUEST_SCRIPTS[0].code;
export const DEFAULT_POST_RESPONSE_SCRIPT_SKELETON = DEFAULT_POST_RESPONSE_SCRIPTS[0].code;
export const DEFAULT_TEST_SCRIPT_SKELETON = DEFAULT_TEST_SCRIPTS[0].code;

export function getDefaultScriptEntriesByType(type: string, name?: string): DefaultScriptEntry[] {
    if (type === 'Encryption') {
        const lowerName = (name || '').trim().toLowerCase();
        if (lowerName.includes('decrypt')) {
            return DEFAULT_DECRYPTION_SCRIPTS;
        }
        return [...DEFAULT_ENCRYPTION_SCRIPTS, ...DEFAULT_DECRYPTION_SCRIPTS];
    }
    if (type === 'PreRequest') return DEFAULT_PRE_REQUEST_SCRIPTS;
    if (type === 'PostRequest') return DEFAULT_POST_RESPONSE_SCRIPTS;
    if (type === 'Test') return DEFAULT_TEST_SCRIPTS;
    return [];
}

export function getDefaultScriptCode(type: string, name?: string, language: ScriptLanguage = 'javascript'): string {
    const entries = getDefaultScriptEntriesByType(type, name);
    if (entries.length === 0) return '';
    const lowerName = (name || '').trim().toLowerCase();
    const matched = (lowerName
        ? entries.find(e => e.name.trim().toLowerCase() === lowerName)
        : undefined) || entries[0];
    if (language === 'python' && matched.pythonCode) {
        return matched.pythonCode;
    }
    return matched.code;
}

export function isDefaultSkeletonCode(code: string): boolean {
    const trimmed = (code || '').trim();
    if (!trimmed) return true;
    const allEntries = [
        ...DEFAULT_ENCRYPTION_SCRIPTS,
        ...DEFAULT_DECRYPTION_SCRIPTS,
        ...DEFAULT_PRE_REQUEST_SCRIPTS,
        ...DEFAULT_POST_RESPONSE_SCRIPTS,
        ...DEFAULT_TEST_SCRIPTS
    ];
    return allEntries.some(e =>
        e.code.trim() === trimmed || (e.pythonCode && e.pythonCode.trim() === trimmed)
    );
}

export const PRE_REQUEST_SNIPPETS: ScriptSnippet[] = [
    {
        id: 'log_timestamp',
        name: 'Log Request Timestamp',
        description: 'Log the current timestamp to the console',
        code: `    console.log("Request started at: " + new Date().toISOString());`,
        pythonCode: `    print("Request started at:", time.time())`
    },
    {
        id: 'add_custom_header',
        name: 'Add Custom Header',
        description: 'Add a custom header directly to the outgoing request',
        code: `    // Add a custom header directly to request Headers
    setHeader("X-Custom-Header", "MyCustomValue");`,
        pythonCode: `    # Add a custom header directly to request Headers
    set_header("X-Custom-Header", "MyCustomValue")`
    },
    {
        id: 'link_body_field',
        name: 'Set Request Body Field',
        description: 'Populate or update a field path inside the outgoing request body',
        code: `    // Populate a field path inside request Body
    setBodyField("meta.requestId", String(Date.now()));`,
        pythonCode: `    # Populate a field path inside request Body
    set_body_field("meta.requestId", str(int(time.time() * 1000)))`
    },
    {
        id: 'link_param_query',
        name: 'Set Request Param / Query',
        description: 'Populate a parameter in Params / URL query string',
        code: `    // Populate request query/param directly
    setParam("source", "pre-script");
    setQuery("version", "2026-11");`,
        pythonCode: `    # Populate request query/param directly
    set_param("source", "pre-script")
    set_query("version", "2026-11")`
    }
];

export const POST_RESPONSE_SNIPPETS: ScriptSnippet[] = [
    {
        id: 'check_200',
        name: 'Check 200 OK',
        description: 'Log if the response status is 200 OK',
        code: `    if (responseStatus === 200) {
        console.log("Request was successful (200 OK)");
    } else {
        console.log("Request failed or returned non-200 status");
    }`,
        pythonCode: `    if response_status == 200:
        print("Request was successful (200 OK)")
    else:
        print("Request failed or returned non-200 status")`
    },
    {
        id: 'log_response_body',
        name: 'Log Response Body',
        description: 'Log the raw response body to the console',
        code: `    console.log("Response Body: ", responseBody);`,
        pythonCode: `    print("Response Body:", response_body)`
    },
    {
        id: 'link_response_to_body',
        name: 'Link Response -> Body Field',
        description: 'Extract a response property and populate a field in Request Body',
        code: `    // Link responseBody.data.id directly into Request Body field "recordId"
    linkResponseToRequest("data.id", "body", "recordId");`,
        pythonCode: `    # Link response_body["data"]["id"] directly into Request Body field "recordId"
    link_response_to_request("data.id", "body", "recordId")`
    },
    {
        id: 'link_response_to_header',
        name: 'Link Response -> Header / Query',
        description: 'Extract a token/value from response and populate a Request Header & Query param',
        code: `    // Link responseBody.token directly into Request Header & Query
    linkResponseToRequest("token", "header", "Authorization");
    linkResponseToRequest("sessionId", "query", "session");`,
        pythonCode: `    # Link response_body["token"] directly into Request Header & Query
    link_response_to_request("token", "header", "Authorization")
    link_response_to_request("sessionId", "query", "session")`
    }
];
