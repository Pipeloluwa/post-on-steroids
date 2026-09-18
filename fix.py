import re

with open('src/app/components/workspace/payload.types.component/payload.types.component.ts', 'r', encoding='utf-8') as f:
    content = f.read()

new_method = '''  async runActiveEncryptionScript() {
      const code = this.encryption().script;
      const state = this.tabState();
      let requestBody = '';
      
      if (state?.bodyType === 'raw') {
          requestBody = state.rawBody || '';
      } else if (state?.bodyType === 'form-data') {
          const fd: Record<string, string> = {};
          for (const row of state.formData || []) {
             if (row.enabled && row.key) fd[row.key] = row.value;
          }
          requestBody = JSON.stringify(fd);
      }
      
      const context = {
          headers: state?.headers || [],
          body: requestBody,
          params: state?.params || [],
          encryptedHeaders: state?.encryption.encryptedHeaders || [],
          encryptedBodyPaths: state?.encryption.encryptedBodyPaths || [],
          autoEncryptBody: state?.encryption.autoEncryptBody || false,
          autoEncryptHeaders: state?.encryption.autoEncryptHeaders || false,
          channelName: state?.encryption.channelName || ''
      };

      const result = await this.sandboxService.executeScript(code, context);
      const currentScripts = state?.scripts || {} as any;

      if (result.success) {
          const bodyOut = result.context?.body;
          const resultString = typeof bodyOut === 'object' ? JSON.stringify(bodyOut, null, 2) : String(bodyOut);
          
          let outText = Result:\\n;
          if (result.logs) {
              outText = Logs:\\n\\n\\n;
          }
          
          this.tabStateService.updateState(this.tabId(), {
              scripts: {
                  ...currentScripts,
                  encryptionConsole: outText
              }
          });
          this.notificationService.notify('Encryption ran successfully. Check console.');
      } else {
          console.error("Encryption run error:", result.error);
          this.tabStateService.updateState(this.tabId(), {
              scripts: {
                  ...currentScripts,
                  encryptionConsole: Error:\\n\\n\\nLogs:\\n
              }
          });
          this.notificationService.notify('Encryption script error: ' + result.error);
      }
    }'''

content = re.sub(r'  async runActiveEncryptionScript\(\) \{.*?(?=  // Pre-Request and Post-Request Logic)', new_method + '\n\n', content, flags=re.DOTALL)

with open('src/app/components/workspace/payload.types.component/payload.types.component.ts', 'w', encoding='utf-8') as f:
    f.write(content)
