with open('src/app/components/workspace/payload.types.component/payload.types.component.ts', 'r', encoding='utf-8') as f:
    content = f.read()

target = "this.notificationService.notify('Encryption script error: ' + result.error);\n        }\n      }"
replacement = "this.notificationService.notify('Encryption script error: ' + result.error);\n        }\n        } finally {\n            this.isRunningEncryptionScript.set(false);\n        }\n      }"

content = content.replace(target, replacement)

with open('src/app/components/workspace/payload.types.component/payload.types.component.ts', 'w', encoding='utf-8') as f:
    f.write(content)
