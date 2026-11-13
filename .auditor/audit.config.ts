import { defineAuditConfig } from '@francogp/auditor';

export default defineAuditConfig({
  name: 'Project',
  auditorVersion: '10.11.6-build.20261113-192534',
  paths: {
    enabled: true,
    srcRoots: ['src'],
    testRoots: ['tests'],
    scriptsRoots: ['scripts'],
    codeRoots: ['src', 'scripts'],
    toolingFiles: ['vite.plugins.ts'],
    includeTestsInCodeAudit: false
  },
  accessibility: {
    enabled: true
  },
  agentPlugin: {
    enabled: true,
    gitSafetyHook: true
  },
  gitIgnore: {
    enabled: true,
    extraRequiredEntries: []
  },
  coverage: {
    enabled: true,
    acknowledgedDegradations: [
      {
        policy: 'scripts',
        glob: 'scripts/**',
        reason: 'Operational dev launcher script in scripts/dev.ts'
      }
    ]
  },
  bundle: {
    enabled: true,
    statsFile: 'scratch/bundle_stats.html',
    distDir: 'dist/assets',
    exemptChunkPrefixes: [],
    maxClientChunkWarnBytes: 1228800,
    maxClientChunkErrorBytes: 2048000,
    budgets: [],
    duplicateModuleThresholdBytes: 512000,
    topModulesLimit: 15
  },
  styles: {
    enabled: true,
    enforceScss: true,
    zLayersEnabled: true
  },
  environment: {
    enabled: true
  },
  dependencyVulnerabilities: {
    enabled: true,
    failOn: 'critical',
    allowList: [],
    includeDev: false
  },
  fallow: {
    enabled: true,
    entry: ['src/index.ts', 'src/client/main.ts'],
    ignoreDependencies: ['@vue/test-utils'],
    ignoreExports: [
      {
        file: 'src/domain/plexFormatter.ts',
        exports: ['sanitizePlexSegment', 'formatEditionTag']
      },
      {
        file: 'src/server/services/preflight.ts',
        exports: ['computeProjectedDestination']
      }
    ],
    health: {
      maxCognitive: 20,
      maxCyclomatic: 25,
      cyclomaticPolicy: 'standard'
    },
    typeAware: false,
    showCascade: true,
    duplicates: {
      nearMiss: true,
      mode: 'strict',
      enabled: true
    },
    viz: {
      enabled: true,
      outputPath: 'scratch/fallow_map.html'
    },
    enforceTargets: true,
    maxTargetPriority: 'high',
    similarCode: {
      enabled: true,
      threshold: 0.95,
      ignoreSameFile: true,
      minLines: 3
    },
    flags: {
      enabled: true,
      trackRetirement: true
    },
    coverage: {
      enabled: true
    },
    security: {
      enabled: true
    }
  },
  encoding: {
    enabled: true,
    defaultEncoding: 'utf-8',
    prohibitBom: true,
    detectMojibake: true
  },
  gitSafety: {
    enabled: true,
    preventDestructiveCommands: true
  },
  htmlValidate: {
    enabled: true
  },
  constants: {
    enabled: true
  },
  oxfmt: {
    enabled: true
  },
  oxlint: {
    enabled: true
  },
  packageHygiene: {
    enabled: true
  },
  packageScripts: {
    enabled: true,
    enforceBuildAudit: true,
    recommendedScripts: true
  },
  scriptCommands: {
    enabled: true
  },
  scriptExtensions: {
    enabled: true,
    enforceTypeScript: true,
    allowMjs: false,
    allowCjs: false,
    allowJsScripts: false,
    exemptFiles: []
  },
  scssArchitecture: {
    enabled: true,
    maxNestingDepth: 3,
    scopedMaxNestingDepth: 4,
    allowPixelArtSpacing: false,
    allowedSpacingUnits: [],
    allowScopedColors: false,
    exemptPaths: []
  },
  stylelint: {
    enabled: true,
    order: {
      enabled: true,
      enforceHasBlockPartitioning: true
    }
  },
  templates: {
    enabled: true,
    requireInputIds: true
  },
  testCoverage: {
    enabled: true,
    threshold: 80,
    path: 'scratch/coverage/coverage-final.json',
    runCommand: 'vp test --coverage',
    roots: ['src'],
    extensions: [
      '.ts',
      '.vue',
      '.js',
      '.jsx',
      '.tsx',
      '.mjs',
      '.cjs'
    ],
    exemptGlobs: [],
    directoryThresholds: {},
    enforceInAudit: true
  },
  typeCoverage: {
    enabled: true,
    atLeast: 95,
    strict: true,
    ignoreFiles: []
  },
  vitePlusConfig: {
    enabled: true,
    run: {
      cache: true
    },
    precompress: {
      enabled: true,
      server: 'nginx',
      spa: true,
      report: 'summary',
      threshold: 512
    },
    fmt: {
      enabled: true,
      singleQuote: true,
      semi: true,
      trailingComma: 'none',
      sortPackageJson: true,
      ignorePatterns: [],
      overrides: []
    },
    lint: {
      enabled: true,
      typeAware: true,
      typeCheck: true,
      plugins: [
        'vitest',
        'node',
        'promise',
        'unicorn',
        'typescript',
        'vue',
        'import',
        'jsx-a11y'
      ]
    },
    test: {
      enabled: true,
      projects: {}
    },
    staged: {
      enabled: true,
      rules: {
        '*': 'vp check --fix'
      }
    },
    hooks: {
      enabled: true
    },
    vscode: {
      enabled: true,
      formatOnSave: true,
      defaultFormatter: 'oxc.oxc-vscode'
    }
  },
  domain: {
    enabled: true
  },
  persistence: {
    enabled: true
  },
  webPerformance: {
    enabled: true,
    maxDomDepth: 16,
    maxInlineSvgSize: 2048,
    exemptSvgPaths: [],
    exemptImgClasses: [],
    exemptPaths: []
  },
  documentation: {
    enabled: true,
    language: 'en',
    chatLanguage: 'es',
    skillsRoots: ['.agents/skills']
  },
  dox: {
    enabled: true,
    ignoreGlobs: ['.agents/**']
  }
});
