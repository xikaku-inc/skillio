// Slack surface — the voice director as an @mention listener over Bolt Socket
// Mode. It is a sibling of (not nested inside) the CopilotKit and express
// surfaces: all three call the same DirectorProvider.
import { App, type AllMiddlewareArgs, type SlackEventMiddlewareArgs } from '@slack/bolt';
import { MissingCredentialError, ProviderError, type SlackConfig } from './config';
import { buildCoachPrompt, type DialogueLine, type DirectorProvider } from './director';

export interface SlackDirectorContext {
  provider: DirectorProvider;
  getJob: () => string;
  getPhase: () => string;
  getPrevious: () => DialogueLine[];
}

function stripMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function startSlack(
  slack: SlackConfig,
  ctx: SlackDirectorContext,
): Promise<App> {
  if (!slack.appToken || !slack.botToken) {
    throw new ProviderError(
      'slack_not_configured',
      'SLACK_APP_TOKEN and SLACK_BOT_TOKEN must both be set to start the Slack bot.',
    );
  }
  const app = new App({ token: slack.botToken, appToken: slack.appToken, socketMode: true });

  app.event(
    'app_mention',
    async ({
      event,
      say,
      context,
    }: SlackEventMiddlewareArgs<'app_mention'> & AllMiddlewareArgs) => {
      void context;
      const text = stripMention(event.text ?? '');
      if (!text) return;
      const thread = event.ts ?? (event as { ts?: string }).ts;
      const reply = (msg: string) => say({ text: msg, thread_ts: thread });
      try {
        const { direction } = await ctx.provider.directText({
          text,
          job: ctx.getJob(),
          phase: ctx.getPhase(),
          previous: ctx.getPrevious(),
        });
        await reply(direction);
      } catch (err) {
        if (err instanceof MissingCredentialError) {
          await reply(`Coach is not configured: ${err.message}`);
        } else if (err instanceof ProviderError) {
          await reply(`Coach error (${err.code}): ${err.message}`);
        } else {
          await reply('Coach hit an unexpected error.');
        }
      }
    },
  );

  await app.start();
  return app;
}