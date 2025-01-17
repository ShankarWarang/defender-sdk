import { BaseApiClient, Network } from '@openzeppelin/defender-sdk-base-client';
import {
  ConditionSet,
  CreateMonitorRequest,
  ExternalCreateBlockMonitorRequest as CreateBlockMonitorRequest,
  ExternalCreateFortaMonitorRequest as CreateFortaMonitorRequest,
  ExternalCreateMonitorRequest,
  ExternalUpdateMonitorRequest as UpdateMonitorRequest,
  NotificationReference,
  PartialCreateBlockMonitorRequest,
  PartialCreateFortaMonitorRequest,
  CreateFortaMonitorResponse,
  CreateBlockMonitorResponse,
} from '../models/monitor';
import { DeletedMonitorResponse, CreateMonitorResponse, ListMonitorResponse } from '../models/response';
import { BlockWatcher } from '../models/blockwatcher';

import _ from 'lodash';
import getConditionSets, { getMonitorConditions } from '../utils';
import {
  NotificationCategory as NotificationCategoryResponse,
  UpdateNotificationCategoryRequest,
} from '../models/category';
import { NotificationResponse } from '..';
import { CreateNotificationRequest, NotificationType, UpdateNotificationRequest } from '../models/notification';

export class MonitorClient extends BaseApiClient {
  protected getPoolId(): string {
    return process.env.DEFENDER_POOL_ID || 'us-west-2_94f3puJWv';
  }

  protected getPoolClientId(): string {
    return process.env.DEFENDER_POOL_CLIENT_ID || '40e58hbc7pktmnp9i26hh5nsav';
  }

  protected getApiUrl(): string {
    // TODO: update to /monitor when available
    return process.env.DEFENDER_API_URL || 'https://defender-api.openzeppelin.com/v2/';
  }

  public async list(): Promise<ListMonitorResponse> {
    return this.apiCall(async (api) => {
      return await api.get(`/monitors`);
    });
  }

  public async create(params: ExternalCreateMonitorRequest): Promise<CreateMonitorResponse> {
    const newMonitor = await this.constructMonitorRequest(params);
    return this.apiCall(async (api) => {
      return await api.post(`/monitors`, newMonitor);
    });
  }

  // TODO: maybe add a named type here
  public async get(id: string): Promise<CreateMonitorResponse> {
    return this.apiCall(async (api) => {
      return await api.get(`/monitors/${id}`);
    });
  }

  public async update(id: string, params: UpdateMonitorRequest): Promise<CreateMonitorResponse> {
    const currentMonitor = await this.get(id);

    return this.apiCall(async (api) => {
      return await api.put(`/monitors/${id}`, await this.mergeApiMonitorWithUpdateMonitor(currentMonitor, params));
    });
  }

  // TODO: maybe add a named type here
  public async delete(id: string): Promise<DeletedMonitorResponse> {
    return this.apiCall(async (api) => {
      return await api.delete(`/monitors/${id}`);
    });
  }

  public async pause(id: string): Promise<ExternalCreateMonitorRequest> {
    const monitor = await this.get(id);
    return this.apiCall(async (api) => {
      return await api.put(
        `/monitors/${id}`,
        await this.mergeApiMonitorWithUpdateMonitor(monitor, {
          monitorId: id,
          type: monitor.type,
          paused: true,
        }),
      );
    });
  }

  public async unpause(id: string): Promise<ExternalCreateMonitorRequest> {
    const monitor = await this.get(id);
    return this.apiCall(async (api) => {
      return await api.put(
        `/monitors/${id}`,
        await this.mergeApiMonitorWithUpdateMonitor(monitor, {
          monitorId: id,
          type: monitor.type,
          paused: false,
        }),
      );
    });
  }

  public async listNotificationCategories(): Promise<NotificationCategoryResponse[]> {
    return this.apiCall(async (api) => {
      return await api.get(`/notifications/categories`);
    });
  }

  public async getNotificationCategory(id: string): Promise<NotificationCategoryResponse> {
    return this.apiCall(async (api) => {
      return await api.get(`/notifications/categories/${id}`);
    });
  }

  public async updateNotificationCategory(
    id: string,
    params: UpdateNotificationCategoryRequest,
  ): Promise<NotificationCategoryResponse> {
    return this.apiCall(async (api) => {
      return await api.put(`/notifications/categories/${id}`, params);
    });
  }

  // TODO: should this be  part of public API?
  public async listBlockwatchers(): Promise<BlockWatcher[]> {
    return this.apiCall(async (api) => {
      return await api.get(`/blockwatchers`);
    });
  }

  public async createNotificationChannel(notification: CreateNotificationRequest): Promise<NotificationResponse> {
    return this.apiCall(async (api) => {
      return await api.post(`/notifications/${notification.type}`, notification);
    });
  }

  public async listNotificationChannels(): Promise<NotificationResponse[]> {
    return this.apiCall(async (api) => {
      return await api.get(`/notifications`);
    });
  }

  public async deleteNotificationChannel(id: string, type: NotificationType): Promise<string> {
    return this.apiCall(async (api) => {
      return await api.delete(`/notifications/${type}/${id}`);
    });
  }

  public async getNotificationChannel(id: string, type: NotificationType): Promise<NotificationResponse> {
    return this.apiCall(async (api) => {
      return await api.get(`/notifications/${type}/${id}`);
    });
  }

  public async updateNotificationChannel(
    id: string,
    notification: UpdateNotificationRequest,
  ): Promise<NotificationResponse> {
    return this.apiCall(async (api) => {
      return await api.put(`/notifications/${notification.type}/${id}`, notification);
    });
  }

  public async getBlockwatcherIdByNetwork(network: string): Promise<BlockWatcher[]> {
    return (await this.listBlockwatchers()).filter((blockwatcher) => blockwatcher.network === network);
  }

  private constructFortaMonitor(monitor: CreateFortaMonitorRequest): PartialCreateFortaMonitorRequest {
    return {
      fortaRule: {
        addresses: monitor.addresses,
        agentIDs: monitor.agentIDs,
        conditions: monitor.fortaConditions,
        autotaskCondition: monitor.autotaskCondition ? { autotaskId: monitor.autotaskCondition } : undefined,
      },
      privateFortaNodeId: monitor.privateFortaNodeId,
      network: monitor.network,
      type: 'FORTA',
    };
  }

  private normaliseABI(abi: any): string | undefined {
    return abi ? (typeof abi === 'string' ? abi : JSON.stringify(abi)) : undefined;
  }

  private async constructBlockMonitor(monitor: CreateBlockMonitorRequest): Promise<PartialCreateBlockMonitorRequest> {
    const blockWatchers = await this.getBlockwatcherIdByNetwork(monitor.network);

    let blockWatcherId;

    if (blockWatchers?.length > 0) {
      const blockWatchersSorted = _.sortBy(
        blockWatchers.filter(({ confirmLevel }) => _.isNumber(confirmLevel)), // Only consider numberish confirmLevels
        ['confirmLevel'],
      ).reverse();
      blockWatcherId = blockWatchersSorted[0]?.blockWatcherId;
    }

    if (monitor.confirmLevel) {
      blockWatcherId = blockWatchers.find((watcher) => watcher.confirmLevel === monitor.confirmLevel)?.blockWatcherId;
    }

    if (!blockWatcherId) {
      throw new Error(`Provided network and confirmLevel do not match a block watcher.`);
    }

    const newConditions: ConditionSet[] = [];

    if (monitor.eventConditions) {
      monitor.eventConditions.map((condition) => {
        newConditions.push({
          eventConditions: [condition],
          txConditions: [],
          functionConditions: [],
        });
      });
    }

    if (monitor.functionConditions) {
      monitor.functionConditions.map((condition) => {
        newConditions.push({
          eventConditions: [],
          txConditions: [],
          functionConditions: [condition],
        });
      });
    }

    if (monitor.txCondition) {
      newConditions.push({
        eventConditions: [],
        txConditions: [{ status: 'any', expression: monitor.txCondition }],
        functionConditions: [],
      });
    }

    const conditions = getMonitorConditions([
      {
        conditions: newConditions,
        abi: this.normaliseABI(monitor.abi),
        addresses: monitor.addresses,
      },
    ]);

    return {
      blockWatcherId,
      addressRules: [
        {
          conditions: getConditionSets(conditions.txExpression, conditions.events, conditions.functions),
          autotaskCondition: monitor.autotaskCondition ? { autotaskId: monitor.autotaskCondition } : undefined,
          addresses: monitor.addresses,
          abi: this.normaliseABI(monitor.abi),
        },
      ],
      network: monitor.network as Network,
      type: 'BLOCK',
      skipABIValidation: monitor.skipABIValidation,
    };
  }

  private async getNotifications(monitorChannels: string[]): Promise<NotificationReference[]> {
    const notifications: NotificationReference[] = [];
    const notificationChannels = await this.listNotificationChannels();

    notificationChannels.map((channel) => {
      if (monitorChannels.includes(channel.notificationId)) {
        notifications.push(channel);
      }
    });

    return notifications;
  }

  private async constructMonitorRequest(monitor: ExternalCreateMonitorRequest): Promise<CreateMonitorRequest> {
    let partialResponse: PartialCreateBlockMonitorRequest | PartialCreateFortaMonitorRequest;

    if (monitor.type === 'BLOCK') {
      partialResponse = await this.constructBlockMonitor(monitor);
    } else if (monitor.type === 'FORTA') {
      partialResponse = this.constructFortaMonitor(monitor);
    } else {
      throw new Error(`Invalid monitor type. Type must be FORTA or BLOCK`);
    }

    const notificationChannels = await this.getNotifications(monitor.notificationChannels);

    return {
      ...partialResponse,
      name: monitor.name,
      alertThreshold: monitor.alertThreshold,
      notifyConfig: {
        notifications: notificationChannels,
        notificationCategoryId: _.isEmpty(notificationChannels) ? monitor.notificationCategoryId : undefined,
        autotaskId: monitor.autotaskTrigger ? monitor.autotaskTrigger : undefined,
        timeoutMs: monitor.alertTimeoutMs ? monitor.alertTimeoutMs : 0,
        messageBody: monitor.alertMessageBody ? monitor.alertMessageBody : undefined,
        messageSubject: monitor.alertMessageSubject ? monitor.alertMessageSubject : undefined,
      },
      paused: monitor.paused ? monitor.paused : false,
      riskCategory: monitor.riskCategory,
      stackResourceId: monitor.stackResourceId,
    };
  }

  private toCreateBlockMonitorRequest(monitor: CreateBlockMonitorResponse): CreateBlockMonitorRequest {
    const rule = monitor.addressRules[0];

    if (!rule) throw new Error(`No rule found for monitor ${monitor.name}`);

    let txCondition;

    for (const condition of rule.conditions) {
      for (const cond of condition.txConditions) {
        if (cond.expression) txCondition = cond.expression;
      }
    }

    return {
      type: 'BLOCK',
      addresses: rule.addresses, // There's only one addressRules at the moment, may cause problems if we add multiple address rules
      abi: this.normaliseABI(rule.abi),
      eventConditions: _.flatten(rule.conditions.map((condition) => condition.eventConditions)),
      functionConditions: _.flatten(rule.conditions.map((condition) => condition.functionConditions)),
      txCondition,
      name: monitor.name,
      paused: monitor.paused,
      skipABIValidation: monitor.skipABIValidation,
      alertThreshold: monitor.alertThreshold,
      autotaskCondition: rule.autotaskCondition?.autotaskId,
      autotaskTrigger: monitor.notifyConfig?.autotaskId,
      alertTimeoutMs: monitor.notifyConfig?.timeoutMs,
      alertMessageSubject: monitor.notifyConfig?.messageSubject,
      alertMessageBody: monitor.notifyConfig?.messageBody,
      notificationChannels: monitor.notifyConfig?.notifications?.map(({ notificationId }) => notificationId) ?? [],
      notificationCategoryId: monitor.notifyConfig?.notificationCategoryId,
      network: monitor.network,
      confirmLevel: parseInt(_.last(monitor.blockWatcherId.split('-')) as string), // We're sure there is always a last number if the convention is followd
    };
  }

  private toCreateFortaMonitorRequest(monitor: CreateFortaMonitorResponse): CreateFortaMonitorRequest {
    return {
      type: 'FORTA',
      name: monitor.name,
      paused: monitor.paused,
      alertThreshold: monitor.alertThreshold,
      autotaskCondition: monitor.fortaRule.autotaskCondition?.autotaskId,
      autotaskTrigger: monitor.notifyConfig?.autotaskId,
      alertTimeoutMs: monitor.notifyConfig?.timeoutMs,
      alertMessageSubject: monitor.notifyConfig?.messageSubject,
      alertMessageBody: monitor.notifyConfig?.messageBody,
      notificationChannels: monitor.notifyConfig?.notifications?.map(({ notificationId }) => notificationId) ?? [],
      notificationCategoryId: monitor.notifyConfig?.notificationCategoryId,
      network: monitor.network,
      fortaLastProcessedTime: monitor.fortaLastProcessedTime,
      addresses: monitor.fortaRule.addresses,
      agentIDs: monitor.fortaRule.agentIDs,
      fortaConditions: monitor.fortaRule.conditions,
      privateFortaNodeId: monitor.privateFortaNodeId,
    };
  }

  private toCreateMonitorRequest(monitor: CreateMonitorResponse): ExternalCreateMonitorRequest {
    if (monitor.type === 'BLOCK') return this.toCreateBlockMonitorRequest(monitor);
    if (monitor.type === 'FORTA') return this.toCreateFortaMonitorRequest(monitor);

    throw new Error(`Invalid monitor type. Type must be FORTA or BLOCK`);
  }

  private mergeApiMonitorWithUpdateMonitor(
    apiMonitor: CreateMonitorResponse,
    monitor: UpdateMonitorRequest,
  ): Promise<CreateMonitorRequest> {
    const newMonitor: ExternalCreateMonitorRequest = this.toCreateMonitorRequest(apiMonitor);

    const updatedProperties = Object.keys(monitor) as Array<keyof typeof monitor>;
    for (const prop of updatedProperties) {
      if (prop !== 'monitorId') {
        (newMonitor[prop] as any) = monitor[prop];
      }
    }

    return this.constructMonitorRequest(newMonitor);
  }
}
