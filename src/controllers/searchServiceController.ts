import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const searchServices = async (req: Request, res: Response) => {
    const { searchTerm } = req.query;

    try {
        const services = await prisma.services.findMany({
            where: {
                deletedAt: null,
                OR: [
                    { name: { contains: searchTerm as string, mode: "insensitive" } },
                    { serviceCode: { contains: searchTerm as string, mode: "insensitive" } },
                ]
            },
            select: {
                id: true,
                name: true,
                serviceCode: true,
                price: true,
                description: true,
            }
        });

        res.status(200).json(services);
    } catch (error) {
        console.error("Error fetching services:", error);
        res.status(500).json({ message: "Error fetching services" });
    }
};
