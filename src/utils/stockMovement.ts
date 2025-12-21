export async function recordStockMovement(
    tx: any,
    data: {
        productVariantId: number;
        branchId: number;
        type: "STOCK_IN" | "STOCK_OUT";
        quantity: number;
        note?: string;
        userId?: number;
    }
) {
    await tx.stockMovements.create({
        data: {
            productVariantId: data.productVariantId,
            branchId: data.branchId,
            type: data.type,
            quantity: data.quantity,
            note: data.note,
            createdBy: data.userId
        }
    });
}
