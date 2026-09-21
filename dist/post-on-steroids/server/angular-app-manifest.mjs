
export default {
  bootstrap: () => import('./main.server.mjs').then(m => m.default),
  inlineCriticalCss: true,
  baseHref: '/',
  locale: undefined,
  routes: [
  {
    "renderMode": 2,
    "route": "/"
  },
  {
    "renderMode": 2,
    "preload": [
      "chunk-EACG64LC.js"
    ],
    "route": "/login"
  },
  {
    "renderMode": 2,
    "route": "/steroid"
  },
  {
    "renderMode": 2,
    "route": "/capsules"
  },
  {
    "renderMode": 2,
    "route": "/export"
  },
  {
    "renderMode": 2,
    "route": "/import"
  },
  {
    "renderMode": 2,
    "route": "/utilities"
  },
  {
    "renderMode": 2,
    "route": "/history"
  },
  {
    "renderMode": 2,
    "redirectTo": "/",
    "route": "/**"
  }
],
  entryPointToBrowserMapping: undefined,
  assets: {
    'index.csr.html': {size: 30299, hash: '5d159ae4b15b401a59ba92b12ca0c9d6e0decc3cbcd9d37048133077f817482b', text: () => import('./assets-chunks/index_csr_html.mjs').then(m => m.default)},
    'index.server.html': {size: 21111, hash: '80fd14b6382e78ace00e6cedc8ad83a54c63aab1d941c1a989b5a46f7ca82510', text: () => import('./assets-chunks/index_server_html.mjs').then(m => m.default)},
    'index.html': {size: 246, hash: '164300e5baf09a76ce16fd53511eca31395cea96d00d1f329fbfe6710f917b25', text: () => import('./assets-chunks/index_html.mjs').then(m => m.default)},
    'steroid/index.html': {size: 75648, hash: '421face1f3a808fa899df8ade8d503082c910eeabebb47e82f80eedac50e8f1b', text: () => import('./assets-chunks/steroid_index_html.mjs').then(m => m.default)},
    'login/index.html': {size: 45816, hash: '8570cf1999868f373410fcdb982467c2e0c37ba10e74f2087644f1f826279719', text: () => import('./assets-chunks/login_index_html.mjs').then(m => m.default)},
    'utilities/index.html': {size: 81355, hash: '2c09da1349e73a296763f5d582921919aff276e09de6400bb0aaa9281a9e018b', text: () => import('./assets-chunks/utilities_index_html.mjs').then(m => m.default)},
    'capsules/index.html': {size: 66436, hash: '6bc11b3ef4dbd0eabdec5d2b87175b65fe2f9251976302450733459cc840fa8d', text: () => import('./assets-chunks/capsules_index_html.mjs').then(m => m.default)},
    'import/index.html': {size: 61582, hash: '6a5e7daaff0618c729ffa85a2fd3c1aca86c33879d47626cae9e1aae03ffc16b', text: () => import('./assets-chunks/import_index_html.mjs').then(m => m.default)},
    'history/index.html': {size: 59352, hash: '6fb6ce13d9b672ae413d96fac01e6f1906a92aa7babcf02bdee62fbc39eee508', text: () => import('./assets-chunks/history_index_html.mjs').then(m => m.default)},
    'export/index.html': {size: 62791, hash: 'd32c5cfbddfeaf28904d60451df761c1c3e1dd6c43095c022cc1208bb43d4190', text: () => import('./assets-chunks/export_index_html.mjs').then(m => m.default)},
    'styles-H2PPJOZI.css': {size: 72763, hash: 'ZUVFB7vjjpI', text: () => import('./assets-chunks/styles-H2PPJOZI_css.mjs').then(m => m.default)}
  },
};
