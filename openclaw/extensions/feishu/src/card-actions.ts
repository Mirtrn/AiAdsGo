import type {
  FeishuAccountConfig,
  InteractiveCard,
  InteractiveCardActionEvent,
} from "openclaw/plugin-sdk";

const DEFAULT_CONFIRM_TIMEOUT_MS = 10_000;

type CardDecision = "confirm" | "cancel";

type ConfirmApiResponse = {
  success?: boolean;
  status?: string;
  error?: string;
  runId?: string;
  taskId?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toCardDecision(value: string | null | undefined): CardDecision {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "cancel" || normalized === "deny" || normalized === "reject") {
    return "cancel";
  }
  return "confirm";
}

function resolveDecision(
  event: InteractiveCardActionEvent,
  actionValue: Record<string, unknown>,
): CardDecision {
  const direct =
    readString(actionValue.decision) ||
    readString(actionValue.action) ||
    readString(actionValue.op) ||
    readString(actionValue.type);
  if (direct) {
    return toCardDecision(direct);
  }
  return toCardDecision(event.action?.tag);
}

function resolveRunId(actionValue: Record<string, unknown>): string | null {
  return (
    readString(actionValue.runId) ||
    readString(actionValue.run_id) ||
    readString(actionValue.commandRunId) ||
    null
  );
}

function resolveConfirmToken(actionValue: Record<string, unknown>): string | null {
  return (
    readString(actionValue.confirmToken) ||
    readString(actionValue.confirm_token) ||
    readString(actionValue.token) ||
    null
  );
}

function resolveConfirmUrl(accountConfig: FeishuAccountConfig): string | null {
  return (
    readString(accountConfig.cardConfirmUrl) ||
    readString(process.env.OPENCLAW_CARD_CONFIRM_URL) ||
    null
  );
}

function resolveConfirmAuthToken(accountConfig: FeishuAccountConfig): string | null {
  return (
    readString(accountConfig.cardConfirmAuthToken) ||
    readString(process.env.OPENCLAW_CARD_CONFIRM_TOKEN) ||
    readString(process.env.OPENCLAW_GATEWAY_TOKEN) ||
    null
  );
}

function resolveConfirmTimeoutMs(accountConfig: FeishuAccountConfig): number {
  const configTimeout = Number(accountConfig.cardConfirmTimeoutMs);
  if (Number.isFinite(configTimeout) && configTimeout > 0) {
    return Math.min(60_000, Math.max(1_000, Math.round(configTimeout)));
  }

  const envTimeout = Number(process.env.OPENCLAW_CARD_CONFIRM_TIMEOUT_MS);
  if (Number.isFinite(envTimeout) && envTimeout > 0) {
    return Math.min(60_000, Math.max(1_000, Math.round(envTimeout)));
  }

  return DEFAULT_CONFIRM_TIMEOUT_MS;
}

function buildCard(params: {
  title: string;
  content: string;
  template?: "blue" | "green" | "yellow" | "red" | "grey";
}): InteractiveCard {
  return {
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      template: params.template || "blue",
      title: {
        tag: "plain_text",
        content: params.title,
      },
    },
    elements: [
      {
        tag: "markdown",
        content: params.content,
      },
    ],
  };
}

function mapConfirmStatusToCard(status: string, taskId?: string | null): InteractiveCard {
  const normalized = status.trim().toLowerCase();
  if (normalized === "queued") {
    const suffix = taskId ? `\n任务ID: \`${taskId}\`` : "";
    return buildCard({
      title: "✅ 已确认执行",
      content: `高风险操作已确认并进入队列。${suffix}`,
      template: "green",
    });
  }

  if (normalized === "canceled") {
    return buildCard({
      title: "⏹️ 已取消",
      content: "操作已取消，不会执行。",
      template: "grey",
    });
  }

  if (normalized === "expired") {
    return buildCard({
      title: "⏱️ 已过期",
      content: "确认已过期，请重新发起操作。",
      template: "yellow",
    });
  }

  if (normalized === "already_processed" || normalized === "duplicate_event") {
    return buildCard({
      title: "ℹ️ 已处理",
      content: "该确认请求已被处理，无需重复点击。",
      template: "blue",
    });
  }

  return buildCard({
    title: "⚠️ 状态未知",
    content: `收到未识别的确认状态：\`${status}\``,
    template: "yellow",
  });
}

function summarizeHttpError(responseStatus: number, responseText: string): string {
  const shortText = responseText.length > 200 ? `${responseText.slice(0, 200)}...` : responseText;
  return `confirm API返回错误 (${responseStatus}): ${shortText || "empty body"}`;
}

export async function handleFeishuCardConfirmAction(params: {
  event: InteractiveCardActionEvent;
  accountId: string;
  accountConfig: FeishuAccountConfig;
  log?: (message: string) => void;
}): Promise<InteractiveCard> {
  const actionValue = asRecord(params.event.action?.value);
  const runId = resolveRunId(actionValue);
  const confirmToken = resolveConfirmToken(actionValue);
  const decision = resolveDecision(params.event, actionValue);
  const confirmUrl = resolveConfirmUrl(params.accountConfig);

  if (!runId || !confirmToken) {
    return buildCard({
      title: "❌ 参数缺失",
      content: "卡片动作缺少 `runId` 或 `confirmToken`，请联系管理员检查按钮参数。",
      template: "red",
    });
  }

  if (!confirmUrl) {
    return buildCard({
      title: "❌ 未配置确认地址",
      content: "未配置 `channels.feishu.cardConfirmUrl`，无法执行确认回调。",
      template: "red",
    });
  }

  const authToken = resolveConfirmAuthToken(params.accountConfig);
  const timeoutMs = resolveConfirmTimeoutMs(params.accountConfig);
  const callbackEventId =
    readString(actionValue.callbackEventId) ||
    readString(params.event.token) ||
    `${params.event.open_message_id}:${params.event.action?.tag || "action"}`;

  const requestBody = {
    runId,
    confirmToken,
    decision,
    channel: "feishu",
    callbackEventId,
    callbackEventType: "feishu.card_action",
    callbackPayload: {
      openId: params.event.open_id,
      userId: params.event.user_id,
      tenantKey: params.event.tenant_key,
      openMessageId: params.event.open_message_id,
      token: params.event.token,
      action: params.event.action,
    },
  };

  params.log?.(
    `[${params.accountId}] forwarding card action to confirm API (runId=${runId}, decision=${decision})`,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(confirmUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        "x-openclaw-channel": "feishu",
        "x-openclaw-sender": params.event.open_id,
        "x-openclaw-account-id": params.accountId,
        "x-openclaw-tenant-key": params.event.tenant_key,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const responseText = await response.text();
    if (!response.ok) {
      return buildCard({
        title: "❌ 确认失败",
        content: summarizeHttpError(response.status, responseText),
        template: "red",
      });
    }

    const parsed = asRecord(
      responseText
        ? (() => {
            try {
              return JSON.parse(responseText) as unknown;
            } catch {
              return {};
            }
          })()
        : {},
    ) as ConfirmApiResponse;

    const status = readString(parsed.status) || "queued";
    const taskId = readString(parsed.taskId);
    return mapConfirmStatusToCard(status, taskId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildCard({
      title: "❌ 请求失败",
      content: `转发确认请求失败：${message}`,
      template: "red",
    });
  } finally {
    clearTimeout(timer);
  }
}
