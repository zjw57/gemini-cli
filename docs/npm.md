# NPM Workspaces

This project uses [NPM Workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces) to manage the packages within this monorepo. This simplifies development by allowing us to manage dependencies and run scripts across multiple packages from the root of the project.

## How it Works

The root `package.json` file defines the workspaces for this project:

```json
{
  "workspaces": ["packages/*"]
}
```

This tells NPM that any folder inside the `packages` directory is a separate package that should be managed as part of the workspace.

## Benefits of Workspaces

- **Simplified Dependency Management**: Running `npm install` from the root of the project will install all dependencies for all packages in the workspace and link them together. This means you don't need to run `npm install` in each package's directory.
- **Automatic Linking**: Packages within the workspace can depend on each other. When you run `npm install`, NPM will automatically create symlinks between the packages. This means that when you make changes to one package, the changes are immediately available to other packages that depend on it.
- **Simplified Script Execution**: You can run scripts in any package from the root of the project using the `--workspace` flag. For example, to run the `build` script in the `cli` package, you can run `npm run build --workspace @google/gemini-cli`.

## Package Overview

This monorepo contains two main packages: `@google/gemini-cli` and `@google/gemini-cli-core`.

### `@google/gemini-cli`

This is the main package for the Gemini CLI. It is responsible for the user interface, command parsing, and all other user-facing functionality.

When this package is published, it is bundled into a single executable file. This bundle includes all of the package's dependencies, including `@google/gemini-cli-core`. This means that whether a user installs the package with `npm install -g @google/gemini-cli` or runs it directly with `npx @google/gemini-cli`, they are using this single, self-contained executable.

### `@google/gemini-cli-core`

This package contains the core logic for interacting with the Gemini API. It is responsible for making API requests, handling authentication, and managing the local cache.

This package is not bundled. When it is published, it is published as a standard Node.js package with its own dependencies. This allows it to be used as a standalone package in other projects, if needed. All transpiled js code in the `dist` folder is included in the package.

## Versioning and Publishing

All packages in this monorepo are versioned together from the root `package.json` file. When a new version is released, the version number in the root `package.json` is updated, and all packages are published with that version.

### Publishing to NPM

When we are ready to publish a new version of the packages to npm, the following steps are taken:

1.  The version number in the root `package.json` is updated.
2.  The `publish:release` script is run from the root of the project. This script builds all the packages, prepares them for publishing, and then publishes them to npm.

When the packages are published, the `workspace:*` dependencies are replaced with the actual version number of the published package. This ensures that when a user installs a package from npm, they get the correct version of its dependencies.

### NPX Installation

When a user runs `npx @google/gemini-cli`, npm downloads the `@google/gemini-cli` package and its dependencies from the npm registry. Because the `workspace:*` dependencies were replaced with the actual version numbers during publishing, npm is able to resolve and download the correct versions of all the required packages.

## Release Process

This project follows a structured release process to ensure that all packages are versioned and published correctly. The process is designed to be as automated as possible, but it still requires some manual steps.

### 1. Create a Release Branch

All releases should be prepared on a dedicated release branch. This allows the release to be reviewed and tested before it is merged into the main branch.

```bash
git checkout -b release/vX.X.X
```

### 2. Run the Versioning Script

The `npm run release:version` script is used to bump the version number of all packages in the monorepo. This script will also update the dependencies between the packages and create a git commit and tag for the new version.

```bash
npm run release:version <patch|minor|major|prerelease>
```

This will do the following:

1.  Bump the version in the root `package.json`.
2.  Run a script to update the `@google/gemini-cli-core` dependency in `@google/gemini-cli`'s `package.json`.
3.  Create a `chore(release): vX.X.X` commit with all the file changes.
4.  Create a `vX.X.X` git tag.

### 3. Push the Commit and Tag

Once the versioning script has been run, you need to push the commit and the new tag to the remote repository. The `push-release` script can be used to do this.

```bash
npm run push-release
```

### 4. Create a Pull Request

After pushing the release branch and tag, create a pull request to merge the release branch into the main branch. The pull request should be reviewed and approved by at least one other maintainer.

The description of the pull request should include a summary of the changes in the release. This will be used to generate the release notes.

### 5. Publish to the Registry

Once the release pull request is merged into the main branch, the packages are automatically published to the npm registry by the CI/CD pipeline. You can monitor the progress of the publishing process in the GitHub Actions tab.

## Local Testing and Validation

It is crucial to test any changes to the packaging and publishing process locally before committing them. This ensures that the packages will be published correctly and that they will work as expected when installed by a user.

To validate your changes, you can perform a dry run of the publishing process. This will simulate the publishing process without actually publishing the packages to the npm registry.

```bash
npm_package_version=9.9.9 SANDBOX_IMAGE_REGISTRY="registry" SANDBOX_IMAGE_NAME="thename" npm run publish:npm --dry-run
```

This command will do the following:

1.  Build all the packages.
2.  Run all the prepublish scripts.
3.  Create the package tarballs that would be published to npm.
4.  Print a summary of the packages that would be published.

You can then inspect the generated tarballs to ensure that they contain the correct files and that the `package.json` files have been updated correctly. The tarballs will be created in the root of each package's directory (e.g., `packages/cli/google-gemini-cli-0.1.6.tgz`).

By performing a dry run, you can be confident that your changes to the packaging process are correct and that the packages will be published successfully.

## Release Deep Dive

can you walk me through all the steps that need to happen to do a release? not specifically which command runs but which
files need to move where and why?

✦ Of course. I can walk you through the conceptual steps of the release process. Based on the file structure and typical
monorepo release patterns, here is a breakdown of how files are gathered, transformed, and published.

The main goal of the release process is to take the source code from the packages/ directory, build it, and assemble a
clean, self-contained package in a temporary dist directory at the root of the project. This dist directory is what
actually gets published to NPM.

Here are the key stages:

Stage 1: Pre-Release Sanity Checks and Versioning

- What happens: Before any files are moved, the process ensures the project is in a good state. This involves running tests,
  linting, and type-checking (npm run preflight). The version number in the root package.json and packages/cli/package.json
  is updated to the new release version.
- Why: This guarantees that only high-quality, working code is released. Versioning is the first step to signify a new
  release.

Stage 2: Building the Source Code

- What happens: The TypeScript source code in packages/core/src and packages/cli/src is compiled into JavaScript.
- File movement:
  - packages/core/src/\*_/_.ts -> compiled to -> packages/core/dist/
  - packages/cli/src/\*_/_.ts -> compiled to -> packages/cli/dist/
- Why: The TypeScript code written during development needs to be converted into plain JavaScript that can be run by
  Node.js. The core package is built first as the cli package depends on it.

Stage 3: Assembling the Final Publishable Package

This is the most critical stage where files are moved and transformed into their final state for publishing. A temporary
dist folder is created at the project root to house the final package contents.

1.  The `package.json` is Transformed:
    - What happens: The package.json from packages/cli/ is read, modified, and written into the root dist/ directory. The
      script scripts/prepare-cli-packagejson.js is responsible for this.
    - File movement: packages/cli/package.json -> (in-memory transformation) -> dist/package.json
    - Why: The final package.json must be different from the one used in development. Key changes include:
      - Removing devDependencies.
      - Removing workspace-specific "dependencies": { "@gemini-cli/core": "workspace:\*" } and ensuring the core code is
        bundled directly into the final JavaScript file.
      - Ensuring the bin, main, and files fields point to the correct locations within the final package structure.

2.  The JavaScript Bundle is Created:
    - What happens: The built JavaScript from both packages/core/dist and packages/cli/dist are bundled into a single,
      executable JavaScript file.
    - File movement: packages/cli/dist/index.js + packages/core/dist/index.js -> (bundled by esbuild) -> dist/cli.js (or a
      similar name).
    - Why: This creates a single, optimized file that contains all the necessary application code. It simplifies the package
      by removing the need for the core package to be a separate dependency on NPM, as its code is now included directly.

3.  Static and Supporting Files are Copied:
    - What happens: Essential files that are not part of the source code but are required for the package to work correctly
      or be well-described are copied into the dist directory.
    - File movement:
      - README.md -> dist/README.md
      - LICENSE -> dist/LICENSE
      - packages/cli/src/utils/\*.sb (sandbox profiles) -> dist/
    - Why:
      - The README.md and LICENSE are standard files that should be included in any NPM package.
      - The sandbox profiles (.sb files) are critical runtime assets required for the CLI's sandboxing feature to
        function. They must be located next to the final executable.

Stage 4: Publishing to NPM

- What happens: The npm publish command is run from inside the root dist directory.
- Why: By running npm publish from within the dist directory, only the files we carefully assembled in Stage 3 are uploaded
  to the NPM registry. This prevents any source code, test files, or development configurations from being accidentally
  published, resulting in a clean and minimal package for users.

Summary of File Flow

    1 [Project Root]
    2 ├── packages/core/src/*.ts  ───────┐
    3 └── packages/cli/src/*.ts   ───────┼──(Build)──> [Bundled JS] ─────┐
    4                                   │                               │
    5 ├── packages/cli/package.json ──(Transform)──> [Final package.json] │
    6                                   │                               │
    7 ├── README.md ────────────────────┤                               ├─(Assemble)─> dist/
    8 ├── LICENSE ─────────────────────┤                               │
    9 └── packages/cli/src/utils/*.sb ─┴───────────────────────────────>│

10 │
11 └─(Publish)─> NPM Registry

This process ensures that the final published artifact is a purpose-built, clean, and efficient representation of the
project, rather than a direct copy of the development workspace.
