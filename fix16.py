import re

with open('src/app/shared/services/tab.state.service.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# I will find the whole script string and replace it with a clean one.
# But since I messed it up, let me just undo the change.
