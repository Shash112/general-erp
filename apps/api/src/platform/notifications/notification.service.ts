import { RequestContext, ValidationError } from '@general-erp/core';
import { logger } from '../../config/logger.js';

export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PUSH';

export interface SendNotificationRequest {
  recipientId: string;
  recipientEmail?: string;
  recipientPhone?: string;
  channels: NotificationChannel[];
  title: string;
  body: string;
  templateId?: string;
  data?: Record<string, unknown>;
}

export interface NotificationDeliveryResult {
  notificationId: string;
  channel: NotificationChannel;
  status: 'DELIVERED' | 'FAILED' | 'QUEUED';
  sentAt: Date;
}

export class NotificationEngine {
  private inAppNotifications = new Map<string, Array<{ id: string; title: string; body: string; read: boolean; timestamp: Date }>>();

  /**
   * Dispatch notification across requested channels
   */
  async sendNotification(ctx: RequestContext, request: SendNotificationRequest): Promise<NotificationDeliveryResult[]> {
    if (!request.recipientId || !request.channels || request.channels.length === 0) {
      throw new ValidationError('Recipient ID and at least one notification channel are required.');
    }

    const results: NotificationDeliveryResult[] = [];
    const notificationId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    for (const channel of request.channels) {
      switch (channel) {
        case 'IN_APP': {
          const userNotifs = this.inAppNotifications.get(`${ctx.tenantId}:${request.recipientId}`) || [];
          userNotifs.unshift({
            id: notificationId,
            title: request.title,
            body: request.body,
            read: false,
            timestamp: new Date()
          });
          this.inAppNotifications.set(`${ctx.tenantId}:${request.recipientId}`, userNotifs);
          results.push({ notificationId, channel, status: 'DELIVERED', sentAt: new Date() });
          break;
        }

        case 'EMAIL': {
          if (!request.recipientEmail) {
            results.push({ notificationId, channel, status: 'FAILED', sentAt: new Date() });
          } else {
            logger.info({ recipientEmail: request.recipientEmail, title: request.title }, '[NOTIFICATION] Email dispatched');
            results.push({ notificationId, channel, status: 'DELIVERED', sentAt: new Date() });
          }
          break;
        }

        case 'SMS':
        case 'WHATSAPP': {
          if (!request.recipientPhone) {
            results.push({ notificationId, channel, status: 'FAILED', sentAt: new Date() });
          } else {
            logger.info({ recipientPhone: request.recipientPhone, channel }, '[NOTIFICATION] Messaging dispatched');
            results.push({ notificationId, channel, status: 'DELIVERED', sentAt: new Date() });
          }
          break;
        }

        default:
          results.push({ notificationId, channel, status: 'QUEUED', sentAt: new Date() });
          break;
      }
    }

    return results;
  }

  /**
   * Get in-app notifications for user
   */
  getInAppNotifications(tenantId: string, userId: string) {
    return this.inAppNotifications.get(`${tenantId}:${userId}`) || [];
  }
}

export const notificationEngine = new NotificationEngine();
