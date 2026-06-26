#!/usr/bin/env node
/**
 * Run this script ONCE locally to get long-lived Garmin OAuth tokens.
 * Supports accounts with MFA (email verification code) enabled.
 * Works on Mac, Linux, and Windows.
 *
 * Usage:
 *   node scripts/get-garmin-tokens.js
 */

const readline = require('readline');

// ── Load .env.local ──────────────────────────────────────────────────────────
try {
  const fs = require('fs');
  const envPath = require('path').join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    });
  }
} catch (_) { /* ignore */ }

// ── Prompt helper ────────────────────────────────────────────────────────────
async function prompt(question, hidden = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  if (hidden && process.stdout.isTTY) {
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    return new Promise(resolve => {
      let input = '';
      process.stdin.on('data', (ch) => {
        ch = ch.toString();
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdout.write('\n');
          rl.close();
          resolve(input);
        } else if (ch === '\u0003') {
          process.exit();
        } else if (ch === '\u007f') {
          input = input.slice(0, -1);
        } else {
          input += ch;
        }
      });
      process.stdin.resume();
    });
  }
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

// ── MFA HTML detection ───────────────────────────────────────────────────────
function isMfaHtml(html) {
  if (typeof html !== 'string') return false;
  return (
    /name=["']?(mfa|verificationCode|code|otpCode)["']?/i.test(html) ||
    /MFA|verification code|enter.*code|email.*code/i.test(html)
  );
}

// ── Complete MFA flow ────────────────────────────────────────────────────────
async function completeMfaLogin(httpClient, mfaHtml) {
  const TICKET_RE = /ticket=([^"&\s]+)/;

  // Parse form action URL
  const actionMatch = mfaHtml.match(/action="([^"]+)"/);
  const mfaUrl = actionMatch
    ? actionMatch[1].replace(/&amp;/g, '&')
    : 'https://sso.garmin.com/sso/verifyMFA/loginEnterMfaCode';

  // Parse CSRF token
  const csrfMatch = mfaHtml.match(/name=["']?_csrf["']?[^>]+value="([^"]+)"/i)
    || mfaHtml.match(/value="([^"]+)"[^>]+name=["']?_csrf["']?/i);
  if (!csrfMatch) {
    throw new Error(
      'Could not find CSRF token in MFA page.\n' +
      'Please open a GitHub issue at https://github.com/cggmx/garmin-health-dashboard/issues'
    );
  }

  // Detect field name (mfa / verificationCode / code / otpCode)
  const fieldMatch = mfaHtml.match(/name=["']?(mfa|verificationCode|code|otpCode)["']?/i);
  const fieldName = fieldMatch ? fieldMatch[1] : 'mfa';

  // Prompt for code
  const mfaCode = await prompt('\n📧  Enter the verification code from your email: ');
  if (!mfaCode) throw new Error('No verification code entered.');

  // POST MFA using URLSearchParams (no extra dependencies, works on all platforms)
  const params = new URLSearchParams();
  params.set(fieldName, mfaCode.trim());
  params.set('_csrf', csrfMatch[1]);
  params.set('embed', 'true');
  params.set('fromPage', 'setupPasswordPage');

  // Use the same axios instance (preserves cookies from the login session)
  const axiosInst = httpClient.client;
  const response = await axiosInst.post(mfaUrl, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://sso.garmin.com',
      Referer: 'https://sso.garmin.com/sso/signin',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    maxRedirects: 5,
  });

  const html = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  const ticketMatch = TICKET_RE.exec(html);
  if (!ticketMatch) {
    throw new Error(
      'MFA code rejected or expired.\n' +
      '  • Make sure you enter the code quickly (expires in ~5 min)\n' +
      '  • If this keeps failing, temporarily disable 2FA in your Garmin account,\n' +
      '    run this script, then re-enable it.'
    );
  }

  console.log('  MFA accepted ✓');
  const oauth1 = await httpClient.getOauth1Token(ticketMatch[1]);
  await httpClient.exchange(oauth1);
}

// ── Save tokens to Vercel ────────────────────────────────────────────────────
// Uses stdin pipe instead of shell echo — works on Mac, Linux and Windows CMD/PowerShell
function addVercelEnv(name, value, cwd) {
  const { execFileSync } = require('child_process');
  // npx on Windows is npx.cmd
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npx, ['vercel', 'env', 'add', name, 'production', '--force'], {
    input: value + '\n',
    stdio: ['pipe', 'inherit', 'inherit'],
    cwd,
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { GarminConnect } = require('garmin-connect');

  let user = process.env.GARMIN_USERNAME;
  let pass = process.env.GARMIN_PASSWORD;

  if (!user) user = await prompt('Garmin username (email): ');
  if (!pass) pass = await prompt('Garmin password: ', true);

  if (!user || !pass) {
    console.error('❌  Username and password are required');
    process.exit(1);
  }

  const client = new GarminConnect({ username: user, password: pass });
  const httpClient = client.client; // internal HttpClient instance

  // ── Patch handleMFA on the INSTANCE (not the prototype/module) ──────────
  // This is reliable on all platforms — no module import needed.
  let capturedMfaHtml = null;

  if (httpClient && typeof httpClient === 'object') {
    const original = httpClient.handleMFA?.bind(httpClient);
    httpClient.handleMFA = function (htmlStr) {
      if (isMfaHtml(htmlStr)) capturedMfaHtml = htmlStr;
      if (original) original(htmlStr); // call original stub too
    };
  }

  // ── Backup: axios response interceptor ───────────────────────────────────
  // Catches the MFA page even if handleMFA is not called by this version
  const axiosInst = httpClient?.client;
  if (axiosInst?.interceptors) {
    axiosInst.interceptors.response.use((response) => {
      if (isMfaHtml(response.data) && !capturedMfaHtml) {
        capturedMfaHtml = response.data;
      }
      return response;
    }, (error) => Promise.reject(error));
  }

  console.log(`\n🔐  Logging in as ${user}...`);

  try {
    await client.login();
    console.log('  Login successful (no MFA required) ✓');
  } catch (err) {
    if (capturedMfaHtml) {
      console.log('  MFA required — waiting for your email code...');
      try {
        await completeMfaLogin(httpClient, capturedMfaHtml);
      } catch (mfaErr) {
        console.error('\n❌  MFA flow failed:', mfaErr.message);
        process.exit(1);
      }
    } else {
      console.error('\n❌  Login failed:', err.message);
      console.error('\nPossible causes:');
      console.error('  • Wrong email or password');
      console.error('  • Garmin is rate-limiting your account — wait 1-2 hours and try again');
      console.error('  • Your account uses an authenticator app (not email) for 2FA —');
      console.error('    temporarily disable 2FA, run this script, then re-enable it');
      process.exit(1);
    }
  }

  // ── Extract tokens ───────────────────────────────────────────────────────
  const oauth1 = httpClient.oauth1Token;
  const oauth2 = httpClient.oauth2Token;

  if (!oauth1 || !oauth2) {
    console.error('❌  Could not extract OAuth tokens after login. Try again.');
    process.exit(1);
  }

  const o1 = JSON.stringify(oauth1);
  const o2 = JSON.stringify(oauth2);

  console.log('\n✅  Tokens obtained!\n');

  // ── Save to Vercel ───────────────────────────────────────────────────────
  const cwd = require('path').join(__dirname, '..');
  const { execFileSync } = require('child_process');
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  try {
    console.log('Adding GARMIN_OAUTH1 to Vercel...');
    addVercelEnv('GARMIN_OAUTH1', o1, cwd);
    console.log('Adding GARMIN_OAUTH2 to Vercel...');
    addVercelEnv('GARMIN_OAUTH2', o2, cwd);
    console.log('\n✅  Tokens added to Vercel!');
    console.log('⚠️   Tokens expire in ~90 days — re-run this script when they do.\n');
    console.log('Deploying...');
    execFileSync(npx, ['vercel', '--prod'], { stdio: 'inherit', cwd });
    console.log('\n🎉  Done! Your dashboard should now show real Garmin data.\n');
  } catch (_) {
    console.log('\n⚠️  Could not save to Vercel automatically.');
    console.log('Add these manually in Vercel → Project → Settings → Environment Variables:\n');
    console.log('  Name:  GARMIN_OAUTH1');
    console.log('  Value:', o1);
    console.log('\n  Name:  GARMIN_OAUTH2');
    console.log('  Value:', o2);
    console.log('\nThen go to Vercel → Deployments → Redeploy.\n');
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
