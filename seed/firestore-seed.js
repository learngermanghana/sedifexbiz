#!/usr/bin/env node
const { execSync } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const ENV_CONFIG = {
  dev: {
    projectId: 'sedifex-dev',
    seeds: {
      workspaces: path.resolve(__dirname, 'workspaces.seed.json'),
      teamMembers: path.resolve(__dirname, 'team-members.seed.json'),
    },
  },
  stage: {
    projectId: 'sedifex-stage',
    seeds: {
      workspaces: path.resolve(__dirname, 'workspaces.seed.json'),
      teamMembers: path.resolve(__dirname, 'team-members.seed.json'),
    },
  },
  prod: {
    projectId: 'sedifex-prod',
    seeds: {
      workspaces: path.resolve(__dirname, 'workspaces.seed.json'),
      teamMembers: path.resolve(__dirname, 'team-members.seed.json'),
    },
  },
};

const args = process.argv.slice(2);
const envArgIndex = args.findIndex((arg) => arg === '--env');
const env = envArgIndex >= 0 ? args[envArgIndex + 1] : args[0];

if (!env || !ENV_CONFIG[env]) {
  console.error('Usage: node seed/firestore-seed.js --env <dev|stage|prod>');
  process.exit(1);
}

const { projectId, seeds } = ENV_CONFIG[env];

Object.entries(seeds).forEach(([key, filePath]) => {
  if (!existsSync(filePath)) {
    console.error(`Missing ${key} seed file: ${filePath}`);
    process.exit(1);
  }
});

console.log('-----------------------------------------');
console.log(`Seeding Firestore for environment: ${env}`);
console.log(`Project ID: ${projectId}`);
console.log(`Workspace seed: ${seeds.workspaces}`);
console.log(`Team members seed: ${seeds.teamMembers}`);
console.log('-----------------------------------------');

const run = (command) => {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: 'inherit' });
};

run(`npx firebase firestore:delete workspaces --project ${projectId} --recursive --force`);
run(`npx firebase firestore:import ${seeds.workspaces} --project ${projectId}`);
run(`npx firebase firestore:delete teamMembers --project ${projectId} --recursive --force`);
run(`npx firebase firestore:import ${seeds.teamMembers} --project ${projectId}`);

console.log('\nFirestore data refreshed successfully.');
