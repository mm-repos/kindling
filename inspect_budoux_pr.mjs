import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('Missing GEMINI_API_KEY in environment or .env');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey, apiVersion: 'v1beta' });

function truncate(str, max = 500) {
  if (!str) return '';
  const clean = String(str).trim();
  return clean.length > max ? `${clean.slice(0, max)}\n... [truncated]` : clean;
}

async function main() {
  console.log('Launching Gemini Managed Agent (gemini-4-carbon) in remote sandbox...\n');

  const stream = await ai.interactions.create({
    agent: 'antigravity-preview-09-2026',
    environment: 'remote',
    agent_config: {
      type: 'antigravity',
      model: 'gemini-4-carbon',
    },
    input:
      'Inspect the latest open pull request on the GitHub repository google/budoux ' +
      '(check https://api.github.com/repos/google/budoux/pulls?state=open&sort=created&direction=desc&per_page=1 ' +
      'and inspect its diff/files). Then provide a clear, structured summary covering: ' +
      'PR number & title, author, creation date, purpose/motivation, key files changed, and any notable review or CI details.',
    stream: true,
  });

  let interactionId = null;
  let environmentId = null;
  const stepTextBuffers = new Map();
  let lastModelStepText = '';

  for await (const event of stream) {
    switch (event.event_type) {
      case 'interaction.created': {
        interactionId = event.interaction?.id || interactionId;
        environmentId = event.interaction?.environment_id || environmentId;
        console.log(
          `[interaction.created] id=${interactionId} status=${event.interaction?.status}`
        );
        break;
      }

      case 'interaction.status_update': {
        if (event.interaction?.environment_id) {
          environmentId = event.interaction.environment_id;
        }
        console.log(
          `\n[status_update] status=${event.interaction?.status}${
            environmentId ? ` env=${environmentId}` : ''
          }`
        );
        break;
      }

      case 'step.start': {
        const stepType = event.step?.type || 'unknown';
        console.log(`\n--- [Step #${event.index} START: ${stepType}] ---`);
        stepTextBuffers.set(event.index, '');

        if (event.step?.name) {
          console.log(`Tool: ${event.step.name}`);
        }
        if (event.step?.arguments && Object.keys(event.step.arguments).length > 0) {
          console.log(`Args: ${truncate(JSON.stringify(event.step.arguments, null, 2), 400)}`);
        }
        break;
      }

      case 'step.delta': {
        const delta = event.delta;
        if (!delta) break;

        if (delta.type === 'text' && delta.text) {
          process.stdout.write(delta.text);
          const prev = stepTextBuffers.get(event.index) || '';
          const updated = prev + delta.text;
          stepTextBuffers.set(event.index, updated);
          lastModelStepText = updated;
        } else if (delta.type === 'thought_summary') {
          const thoughtText =
            typeof delta.content === 'string'
              ? delta.content
              : delta.content?.text || JSON.stringify(delta.content);
          if (thoughtText) {
            process.stdout.write(`[Thought] ${thoughtText}\n`);
          }
        } else if (delta.type === 'code_execution_call') {
          console.log(
            `[Sandbox Exec]\n${truncate(JSON.stringify(delta.arguments, null, 2), 600)}`
          );
        } else if (delta.type === 'code_execution_result') {
          const tag = delta.is_error ? '[Sandbox Error]' : '[Sandbox Output]';
          console.log(`${tag}\n${truncate(delta.result, 600)}`);
        } else if (delta.type === 'arguments_delta' && delta.arguments) {
          process.stdout.write(delta.arguments);
        } else if (delta.type === 'google_search_call' || delta.type === 'url_context_call') {
          console.log(`[${delta.type}] ${truncate(JSON.stringify(delta), 300)}`);
        } else if (delta.type !== 'thought_signature') {
          console.log(`[Delta: ${delta.type}] ${truncate(JSON.stringify(delta), 300)}`);
        }
        break;
      }

      case 'step.stop': {
        const tokens = event.step_usage?.total_tokens ?? event.usage?.total_tokens;
        console.log(
          `\n--- [Step #${event.index} DONE${tokens ? ` | tokens: ${tokens}` : ''}] ---`
        );
        break;
      }

      case 'interaction.completed': {
        interactionId = event.interaction?.id || interactionId;
        environmentId = event.interaction?.environment_id || environmentId;
        const totalTokens = event.interaction?.usage?.total_tokens;
        console.log(
          `\n[interaction.completed] status=${event.interaction?.status}${
            environmentId ? ` sandbox=${environmentId}` : ''
          }${totalTokens ? ` total_tokens=${totalTokens}` : ''}`
        );
        break;
      }

      case 'error': {
        console.error('\n[Stream Error Event]', JSON.stringify(event, null, 2));
        break;
      }

      default: {
        console.log(`\n[${event.event_type}]`, truncate(JSON.stringify(event), 300));
      }
    }
  }

  let finalSummary = lastModelStepText.trim();
  if (!finalSummary && interactionId) {
    try {
      const full = await ai.interactions.get(interactionId);
      if (full?.output_text) {
        finalSummary = full.output_text.trim();
      }
    } catch {
      // Ignore fallback lookup errors if stream already finished
    }
  }

  console.log('\n============================================================');
  console.log('FINAL SUMMARY (google/budoux Latest Open PR)');
  console.log('============================================================\n');
  console.log(finalSummary || '(No final text summary returned)');
}

main().catch((err) => {
  console.error('\nFatal error running Managed Agent:', err);
  process.exit(1);
});
