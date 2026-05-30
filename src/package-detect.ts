import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectStateDir } from './config.js';

// ── Package Manager Detection ──────────────────────────────────────────

export interface PackageManagerInfo {
  name: string;
  command: string;
  installCmd: string;
  runCmd: string;
  lockFile?: string;
}

export interface TestRunnerInfo {
  name: string;
  command: string;
  coverageCommand: string;
  framework: string;
}

export interface BuildToolInfo {
  name: string;
  command: string;
  watchCommand?: string;
}

/**
 * Detects the package manager used in the project.
 * Priority order:
 * 1. GRAWKUS_PACKAGE_MANAGER env var
 * 2. .grawkus/package-manager.json in cwd (falls back to .grawkus if present)
 * 3. package.json packageManager field
 * 4. Lock file detection
 * 5. Fallback: which command check
 */
export function detectPackageManager(cwd: string): PackageManagerInfo {
  // 1. Check environment variable
  const envPm = process.env.GRAWKUS_PACKAGE_MANAGER;
  if (envPm) {
    return getPackageManagerInfo(envPm);
  }

  // 2. Check <project-state>/package-manager.json
  const configPath = join(getProjectStateDir(cwd), 'package-manager.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (config.packageManager) {
        return getPackageManagerInfo(config.packageManager);
      }
    } catch {
      // Continue to next detection method
    }
  }

  // 3. Check package.json packageManager field
  const packageJsonPath = join(cwd, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      if (packageJson.packageManager) {
        const pmString = packageJson.packageManager;
        const pmName = pmString.split('@')[0];
        return getPackageManagerInfo(pmName);
      }
    } catch {
      // Continue to next detection method
    }
  }

  // 4. Lock file detection
  const lockFiles: [string, string][] = [
    ['package-lock.json', 'npm'],
    ['yarn.lock', 'yarn'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['bun.lockb', 'bun'],
  ];

  for (const [lockFile, pmName] of lockFiles) {
    if (existsSync(join(cwd, lockFile))) {
      return getPackageManagerInfo(pmName);
    }
  }

  // 5. Check other language package managers
  const otherManagers: [string, string][] = [
    ['Cargo.toml', 'cargo'],
    ['go.mod', 'go'],
    ['pyproject.toml', 'pip'],
    ['setup.py', 'pip'],
    ['Gemfile', 'bundler'],
  ];

  for (const [file, pmName] of otherManagers) {
    if (existsSync(join(cwd, file))) {
      return getPackageManagerInfo(pmName);
    }
  }

  // 6. Fallback: check which are installed
  const fallbackOrder = ['npm', 'yarn', 'pnpm', 'bun', 'cargo', 'go', 'pip', 'bundler'];
  for (const pm of fallbackOrder) {
    try {
      execSync(`which ${pm}`, { stdio: 'ignore' });
      return getPackageManagerInfo(pm);
    } catch {
      // Continue
    }
  }

  // Final fallback to npm
  return getPackageManagerInfo('npm');
}

/**
 * Maps package manager name to full info
 */
function getPackageManagerInfo(name: string): PackageManagerInfo {
  const managers: Record<string, PackageManagerInfo> = {
    npm: {
      name: 'npm',
      command: 'npm',
      installCmd: 'npm install',
      runCmd: 'npm run',
      lockFile: 'package-lock.json',
    },
    yarn: {
      name: 'yarn',
      command: 'yarn',
      installCmd: 'yarn install',
      runCmd: 'yarn run',
      lockFile: 'yarn.lock',
    },
    pnpm: {
      name: 'pnpm',
      command: 'pnpm',
      installCmd: 'pnpm install',
      runCmd: 'pnpm run',
      lockFile: 'pnpm-lock.yaml',
    },
    bun: {
      name: 'bun',
      command: 'bun',
      installCmd: 'bun install',
      runCmd: 'bun run',
      lockFile: 'bun.lockb',
    },
    cargo: {
      name: 'cargo',
      command: 'cargo',
      installCmd: 'cargo add',
      runCmd: 'cargo run',
    },
    go: {
      name: 'go',
      command: 'go',
      installCmd: 'go get',
      runCmd: 'go run',
    },
    pip: {
      name: 'pip',
      command: 'pip',
      installCmd: 'pip install',
      runCmd: 'python -m',
    },
    bundler: {
      name: 'bundler',
      command: 'bundle',
      installCmd: 'bundle install',
      runCmd: 'bundle exec',
    },
  };

  return managers[name.toLowerCase()] || managers['npm'];
}

// ── Test Runner Detection ──────────────────────────────────────────

/**
 * Detects the test runner used in the project
 */
export function detectTestRunner(cwd: string): TestRunnerInfo {
  const packageJsonPath = join(cwd, 'package.json');
  const pyprojectPath = join(cwd, 'pyproject.toml');
  const cargoPath = join(cwd, 'Cargo.toml');
  const goPath = join(cwd, 'go.mod');

  // JavaScript/TypeScript test runners
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      if (deps.jest) {
        return {
          name: 'jest',
          command: 'jest',
          coverageCommand: 'jest --coverage',
          framework: 'javascript',
        };
      }

      if (deps.vitest) {
        return {
          name: 'vitest',
          command: 'vitest',
          coverageCommand: 'vitest --coverage',
          framework: 'javascript',
        };
      }

      if (deps.mocha) {
        return {
          name: 'mocha',
          command: 'mocha',
          coverageCommand: 'nyc mocha',
          framework: 'javascript',
        };
      }

      if (deps.playwright) {
        return {
          name: 'playwright',
          command: 'playwright test',
          coverageCommand: 'playwright test --reporter=coverage',
          framework: 'javascript',
        };
      }

      if (deps.cypress) {
        return {
          name: 'cypress',
          command: 'cypress run',
          coverageCommand: 'cypress run --coverage',
          framework: 'javascript',
        };
      }

      // Check for vitest config files
      if (
        existsSync(join(cwd, 'vitest.config.ts')) ||
        existsSync(join(cwd, 'vitest.config.js'))
      ) {
        return {
          name: 'vitest',
          command: 'vitest',
          coverageCommand: 'vitest --coverage',
          framework: 'javascript',
        };
      }

      // Check for jest config files
      if (
        existsSync(join(cwd, 'jest.config.js')) ||
        existsSync(join(cwd, 'jest.config.ts')) ||
        existsSync(join(cwd, 'jest.config.json'))
      ) {
        return {
          name: 'jest',
          command: 'jest',
          coverageCommand: 'jest --coverage',
          framework: 'javascript',
        };
      }
    } catch {
      // Continue to next detection
    }
  }

  // Python test runners
  if (existsSync(pyprojectPath)) {
    try {
      const pyproject = readFileSync(pyprojectPath, 'utf-8');

      if (pyproject.includes('pytest')) {
        return {
          name: 'pytest',
          command: 'pytest',
          coverageCommand: 'pytest --cov',
          framework: 'python',
        };
      }

      if (pyproject.includes('unittest')) {
        return {
          name: 'unittest',
          command: 'python -m unittest',
          coverageCommand: 'coverage run -m unittest',
          framework: 'python',
        };
      }
    } catch {
      // Continue
    }
  }

  // Python setup.py based projects
  if (existsSync(join(cwd, 'setup.py'))) {
    try {
      const setup = readFileSync(join(cwd, 'setup.py'), 'utf-8');
      if (setup.includes('pytest')) {
        return {
          name: 'pytest',
          command: 'pytest',
          coverageCommand: 'pytest --cov',
          framework: 'python',
        };
      }
    } catch {
      // Continue
    }
  }

  // Rust test runner (cargo)
  if (existsSync(cargoPath)) {
    return {
      name: 'cargo test',
      command: 'cargo test',
      coverageCommand: 'cargo tarpaulin',
      framework: 'rust',
    };
  }

  // Go test runner
  if (existsSync(goPath)) {
    return {
      name: 'go test',
      command: 'go test ./...',
      coverageCommand: 'go test -cover ./...',
      framework: 'go',
    };
  }

  // Ruby test runners
  if (existsSync(join(cwd, 'Gemfile'))) {
    try {
      const gemfile = readFileSync(join(cwd, 'Gemfile'), 'utf-8');

      if (gemfile.includes('rspec')) {
        return {
          name: 'rspec',
          command: 'rspec',
          coverageCommand: 'rspec --coverage',
          framework: 'ruby',
        };
      }

      if (gemfile.includes('minitest')) {
        return {
          name: 'minitest',
          command: 'ruby -Ilib:test test/**/*_test.rb',
          coverageCommand: 'ruby -Ilib:test test/**/*_test.rb',
          framework: 'ruby',
        };
      }
    } catch {
      // Continue
    }
  }

  // PHP test runners
  if (existsSync(join(cwd, 'composer.json'))) {
    try {
      const composer = JSON.parse(readFileSync(join(cwd, 'composer.json'), 'utf-8'));
      const devDeps = composer.devDependencies || {};

      if (devDeps.phpunit) {
        return {
          name: 'phpunit',
          command: 'vendor/bin/phpunit',
          coverageCommand: 'vendor/bin/phpunit --coverage-html coverage',
          framework: 'php',
        };
      }

      if (devDeps.behat) {
        return {
          name: 'behat',
          command: 'vendor/bin/behat',
          coverageCommand: 'vendor/bin/behat',
          framework: 'php',
        };
      }
    } catch {
      // Continue
    }
  }

  // Default fallback based on detected package manager
  const pm = detectPackageManager(cwd);

  if (pm.name === 'cargo') {
    return {
      name: 'cargo test',
      command: 'cargo test',
      coverageCommand: 'cargo tarpaulin',
      framework: 'rust',
    };
  }

  if (pm.name === 'go') {
    return {
      name: 'go test',
      command: 'go test ./...',
      coverageCommand: 'go test -cover ./...',
      framework: 'go',
    };
  }

  // Default to jest for Node.js projects
  return {
    name: 'jest',
    command: 'jest',
    coverageCommand: 'jest --coverage',
    framework: 'javascript',
  };
}

// ── Build Tool Detection ───────────────────────────────────────────

/**
 * Detects the build tool used in the project
 */
export function detectBuildTool(cwd: string): BuildToolInfo {
  const packageJsonPath = join(cwd, 'package.json');
  const cargoPath = join(cwd, 'Cargo.toml');
  const goPath = join(cwd, 'go.mod');
  const makePath = join(cwd, 'Makefile');
  const buildGradle = join(cwd, 'build.gradle');
  const pomPath = join(cwd, 'pom.xml');

  // JavaScript/TypeScript build tools
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      // Check for vite
      if (deps.vite) {
        return {
          name: 'vite',
          command: 'vite build',
          watchCommand: 'vite build --watch',
        };
      }

      // Check for webpack
      if (deps.webpack) {
        return {
          name: 'webpack',
          command: 'webpack',
          watchCommand: 'webpack --watch',
        };
      }

      // Check for esbuild
      if (deps.esbuild) {
        return {
          name: 'esbuild',
          command: 'esbuild',
          watchCommand: 'esbuild --watch',
        };
      }

      // Check for tsup
      if (deps.tsup) {
        return {
          name: 'tsup',
          command: 'tsup',
          watchCommand: 'tsup --watch',
        };
      }

      // Check for rollup
      if (deps.rollup) {
        return {
          name: 'rollup',
          command: 'rollup -c',
          watchCommand: 'rollup -c --watch',
        };
      }

      // Check for parcel
      if (deps.parcel) {
        return {
          name: 'parcel',
          command: 'parcel build',
          watchCommand: 'parcel',
        };
      }

      // Check for tsc (TypeScript)
      if (deps.typescript) {
        return {
          name: 'tsc',
          command: 'tsc',
          watchCommand: 'tsc --watch',
        };
      }
    } catch {
      // Continue to next detection
    }
  }

  // Check for config files
  if (existsSync(join(cwd, 'vite.config.ts')) || existsSync(join(cwd, 'vite.config.js'))) {
    return {
      name: 'vite',
      command: 'vite build',
      watchCommand: 'vite build --watch',
    };
  }

  if (existsSync(join(cwd, 'webpack.config.js')) || existsSync(join(cwd, 'webpack.config.ts'))) {
    return {
      name: 'webpack',
      command: 'webpack',
      watchCommand: 'webpack --watch',
    };
  }

  if (existsSync(join(cwd, 'esbuild.js'))) {
    return {
      name: 'esbuild',
      command: 'esbuild',
      watchCommand: 'esbuild --watch',
    };
  }

  if (existsSync(join(cwd, 'rollup.config.js')) || existsSync(join(cwd, 'rollup.config.ts'))) {
    return {
      name: 'rollup',
      command: 'rollup -c',
      watchCommand: 'rollup -c --watch',
    };
  }

  if (existsSync(join(cwd, 'tsconfig.json'))) {
    return {
      name: 'tsc',
      command: 'tsc',
      watchCommand: 'tsc --watch',
    };
  }

  // Rust build tool (cargo)
  if (existsSync(cargoPath)) {
    return {
      name: 'cargo',
      command: 'cargo build',
      watchCommand: 'cargo watch -x build',
    };
  }

  // Go build tool
  if (existsSync(goPath)) {
    return {
      name: 'go build',
      command: 'go build',
      watchCommand: 'go build ./...',
    };
  }

  // Make
  if (existsSync(makePath)) {
    return {
      name: 'make',
      command: 'make build',
      watchCommand: 'make watch',
    };
  }

  // Gradle (Java)
  if (existsSync(buildGradle)) {
    return {
      name: 'gradle',
      command: 'gradle build',
      watchCommand: 'gradle build --continuous',
    };
  }

  // Maven (Java)
  if (existsSync(pomPath)) {
    return {
      name: 'maven',
      command: 'mvn clean package',
      watchCommand: 'mvn install -DskipTests',
    };
  }

  // Default fallback
  return {
    name: 'tsc',
    command: 'tsc',
    watchCommand: 'tsc --watch',
  };
}
