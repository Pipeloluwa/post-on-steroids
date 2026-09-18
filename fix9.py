import re

with open('src/app/shared/services/sandbox.execution.service.ts', 'r', encoding='utf-8') as f:
    content = f.read()

target = r'''\s*const fnBody = "return \(async \(\) => \{\\n"
\s*\+ paramDeclarations \+ "\\n"
\s*\+ code \+ "\\n"
\s*\+ "if \(typeof preScript === 'function'\) \{ const _preReturn = await preScript\(headers, body, params\); if \(_preReturn !== undefined\) \{ body = _preReturn; \} \}\\n"
\s*\+ "if \(typeof postScript === 'function'\) \{ await postScript\(responseHeaders \|\| responseHeader, responseBody, headers, body, params\); \}\\n"
\s*\+ "if \(typeof testScript === 'function'\) \{ const _testReturn = await testScript\(responseStatus, responseTime, responseBody, responseHeaders \|\| responseHeader\); if \(_testReturn !== undefined\) \{ testPassed = !!_testReturn; \} \}\\n"
\s*\+ "if \(typeof encryptScript === 'function'\) \{ const _encReturn = await encryptScript\(headers, body, params, encryptedHeaders, encryptedBodyPaths\); if \(_encReturn !== undefined\) \{ body = _encReturn; \} \}\\n"
\s*\+ paramWriteBack \+ "\\n"
\s*\+ "\}\)\(\);";'''

replacement = '''
      const fnBodyLines = [
        "return (async () => {",
        paramDeclarations,
        code,
        "if (typeof preScript === 'function') { const _preReturn = await preScript(headers, body, params); if (_preReturn !== undefined) { body = _preReturn; } }",
        "if (typeof postScript === 'function') { await postScript(responseHeaders || responseHeader, responseBody, headers, body, params); }",
        "if (typeof testScript === 'function') { const _testReturn = await testScript(responseStatus, responseTime, responseBody, responseHeaders || responseHeader); if (_testReturn !== undefined) { testPassed = !!_testReturn; } }",
        "if (typeof encryptScript === 'function') { const _encReturn = await encryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths); if (_encReturn !== undefined) { body = _encReturn; } }",
        paramWriteBack,
        "})();"
      ];
      const fnBody = fnBodyLines.join(String.fromCharCode(10));
'''

new_content = re.sub(target, replacement, content)

with open('src/app/shared/services/sandbox.execution.service.ts', 'w', encoding='utf-8') as f:
    f.write(new_content)
