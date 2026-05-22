import { Db } from 'mongodb';
import { ethers } from 'ethers';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';
import { logger } from '../../db/logger';

interface AgentModel {
  ownerWallet: string;
  agentWallet: string;
  privateKey: string;
  createdAt: Date;
}

export class AgentRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.aiModels);
  }

  async createAgentForNewUser(ownerWallet: string): Promise<void> {
    const existing = await this.collection.findOne({ ownerWallet });
    if (existing) return;

    const wallet = ethers.Wallet.createRandom();
    const agent: AgentModel = {
      ownerWallet,
      agentWallet: wallet.address,
      privateKey: wallet.privateKey,
      createdAt: new Date(),
    };

    await this.collection.insertOne(agent);
    logger.info({ ownerWallet, agentWallet: wallet.address }, 'AI agent created');
  }

  async findByOwner(ownerWallet: string): Promise<AgentModel | null> {
    return this.collection.findOne<AgentModel>({ ownerWallet });
  }
}
