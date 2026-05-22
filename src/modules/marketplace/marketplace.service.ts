import { nanoid } from 'nanoid';
import { ObjectId } from 'mongodb';
import { AppError } from '../../core/error';
import { ListingRepository, OrderRepository } from './marketplace.repository';
import { ListingModel, OrderModel } from './marketplace.model';

interface ListingsResponse {
  listings: ListingModel[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface PrepareOrderRequest {
  listingId: string;
  paymentToken: string;
  quantity?: number;
}

export class MarketplaceService {
  constructor(
    private readonly listingRepo: ListingRepository,
    private readonly orderRepo: OrderRepository,
  ) {}

  async getListings(
    gameIdentification: string | undefined,
    category: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<ListingsResponse> {
    const skip = (page - 1) * pageSize;
    const { items, totalCount } = await this.listingRepo.findActive(gameIdentification, category, skip, pageSize);
    return {
      listings: items,
      totalCount,
      page,
      pageSize,
      totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize),
    };
  }

  async getListing(id: string): Promise<ListingModel> {
    const listing = await this.listingRepo.findById(id);
    if (!listing) throw AppError.notFound('Listing not found');
    return listing;
  }

  async prepareOrder(
    playerId: string,
    buyerWallet: string,
    req: PrepareOrderRequest,
  ): Promise<OrderModel> {
    const listing = await this.listingRepo.findById(req.listingId);
    if (!listing || listing.status !== 'active') {
      throw AppError.notFound('Listing not found or not active');
    }

    const order: OrderModel = {
      listingId: listing._id as ObjectId,
      orderId: nanoid(),
      playerId,
      buyerWallet,
      gameIdentification: listing.gameIdentification,
      paymentToken: req.paymentToken,
      pricePaid: listing.price,
      quantity: req.quantity ?? 1,
      status: 'pending',
    };

    return this.orderRepo.create(order);
  }

  async completeOrder(orderId: string, txHash: string): Promise<void> {
    const order = await this.orderRepo.findByOrderId(orderId);
    if (!order) throw AppError.notFound('Order not found');
    if (order.status !== 'pending') throw AppError.conflict('Order already processed');

    await this.orderRepo.updateStatus(orderId, 'completed', txHash);
  }

  async getMyOrders(playerId: string): Promise<OrderModel[]> {
    return this.orderRepo.findByPlayer(playerId);
  }
}
