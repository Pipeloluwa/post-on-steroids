# ⚡ PostOnSteroids

**PostOnSteroids** is an open-source, powerful, and highly customizable API client built for developers who need more control over their API requests. Built with **Angular** and **Electron**, it works seamlessly as both a web application and a native desktop client.

Whether you're testing standard REST APIs, running complex pre/post-request scripts in a secure sandbox, or testing encrypted payloads, PostOnSteroids gives you the flexibility you need.

## ✨ Features

- 🖥️ **Cross-Platform:** Runs as a web app or a standalone Desktop application (via Electron).
- 🔒 **Payload Encryption Engine:** Automatically encrypt specific JSON fields in your request bodies using custom encryption scripts before the request is sent.
- 🛠️ **Sandboxed Scripting:** Write JavaScript for Pre-request, Post-request, and Test scripts. Scripts run securely in an isolated iframe sandbox.
- 📝 **Monaco Editor Integration:** Full syntax highlighting and code completion for your JSON payloads and scripts, powered by the same editor engine as VS Code.
- 🎨 **Dynamic Theming:** Seamless light/dark mode support that natively integrates with your OS window borders.
- 🚀 **Performance Focused:** Built with Angular's latest features (Signals, Standalone Components, OnPush Change Detection) for a lightning-fast experience.

## 🚀 Getting Started

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed on your machine.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Pipeloluwa/post-on-steroids.git
   cd post-on-steroids
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Running the App

**For the Web Version:**
```bash
npm start
```
*Navigates to `http://localhost:4200/`*

**For the Desktop (Electron) Version:**
```bash
# First, build the Angular app
npm run build

# Then start Electron
npm run electron
```

### Packaging for Production
To build a production-ready Windows executable (`.exe`):
```bash
npm run electron:build
```
*The compiled application will be generated in the `release/` directory.*

## 🤝 Contributing

PostOnSteroids is an **open-source project**, and contributions are highly appreciated! Whether it's reporting a bug, proposing a new feature, or submitting a Pull Request, your help makes this tool better for everyone.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Please ensure your code follows the established Angular guidelines found in `AGENTS.md` (e.g., using signals, standalone components, and strict typing).

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
