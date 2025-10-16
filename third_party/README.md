# Third-Party Dependencies

This directory contains vendored third-party dependencies that are included
directly in the repository.

## `ink`

The `ink` package is a direct fork from
[https://github.com/jacob314/ink](https://github.com/jacob314/ink), included as
a tarball to prevent build issues on the CI server.

When updating the `ink` dependency, you **must** use the `master` branch from
the fork, as this is the only branch that follows proper code review guidelines.

To update it, follow these steps:

1.  **Clone or navigate to your local clone of the `ink` fork:**

    ```bash
    # If you don't have it cloned:
    git clone https://github.com/jacob314/ink.git
    cd ink

    # If you already have it:
    cd path/to/your/ink/fork
    ```

2.  **Ensure you are on the `master` branch and have the latest changes:**

    ```bash
    git checkout master
    git pull origin master
    ```

3.  **Install dependencies:**

    ```bash
    npm install
    ```

4.  **Create a new tarball:**

    ```bash
    npm pack
    ```

    This will generate a file named `ink-x.y.z.tgz`.

5.  **Copy the new tarball to this directory, overwriting the existing one:**

    ```bash
    cp ink-x.y.z.tgz path/to/gemini-cli/third_party/
    ```

6.  **Update the `package.json` in `packages/cli` to point to the new tarball if
    the version number has changed.**

7.  **Navigate back to the `gemini-cli` repository and run `npm install` to
    ensure the changes are applied:**
    ```bash
    cd path/to/gemini-cli
    npm install
    ```
