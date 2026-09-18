import re

with open('src/app/components/workspace/payload.types.component/payload.types.component.ts', 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r'\s*channelNames = \[.*?\];', '', content)
content = re.sub(r'channelName:\s*state\?\.encryption\.channelName \|\| \'\'', '', content)
content = re.sub(r',\s*channelName:\s*\'\'', '', content)

with open('src/app/components/workspace/payload.types.component/payload.types.component.ts', 'w', encoding='utf-8') as f:
    f.write(content)
