import { Request, Response } from "express";
import { DateTime } from 'luxon';
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from '@prisma/client';
import logger from "../utils/logger";

const prisma = new PrismaClient();

const setAuthToken = (res: Response, token: string) => {
    res.cookie("auth_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 86400000
    });
}

const generateToken = (user: any): string => {
    return jwt.sign(
        { userId: user.id, email: user.email, roleType: user.roleType, name: `${user.lastName} ${user.firstName}` },
        process.env.JWT_SECRET_KEY as string,
        { expiresIn: "1d" }
    );
}

if (!process.env.JWT_SECRET_KEY) {
    throw new Error("JWT_SECRET_KEY is not defined");
}

export const signIn = async(req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;
    try {
        const user = await prisma.user.findUnique({ where: { email} });
        if (!user) {
            res.status(400).json({ message: "Invalid Credentials" });
            return;
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            res.status(400).json({ message: "Invalid Credentials" });
            return;
        }

        if (user.status === 0) {
            res.status(400).json({ message: "This user was disactived" });
            logger.error("password is not match");
            return;
        }

        const token = generateToken(user);
        setAuthToken(res, token);

        res.status(200).json({user, token});
    } catch (error) {
        logger.error("Login error", error);
        res.status(500).json({ message: "Something went wrong" });
    }
}

export const signUpUser = async(req: Request, res: Response): Promise<void> => {
    const {firstName, lastName, phoneNumber, email, password} = req.body;

    // Convert local time to UTC
    const utcNow = DateTime.now().setZone('Asia/Phnom_Penh').toUTC();
    try {
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            res.status(400).json({ message: "User with this email already exist" });
            return;
        }
        
        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: { firstName, lastName, phoneNumber, email, password: hashedPassword, status: 1, createdAt: utcNow.toJSDate(),  updatedAt: utcNow.toJSDate() },
        });

        const token = jwt.sign(
            { userId: user.id, email: user.email, roleType: user.roleType, name: `${user.lastName} ${user.firstName}` },
            process.env.JWT_SECRET_KEY as string,
            { expiresIn: "1d" }
        );

        res.cookie("auth_token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            maxAge: 86400000
        });

        res.status(201).json(user);
    } catch (error) {
        logger.error("Create user error", error);
        res.status(500).json({ error: 'An error occurred while creating the user' });
    }
}

export const validateToken = async (req: Request, res: Response): Promise<void> => {
    if (req.user) {
        res.status(200).send({
            userId: req.user.id,
            branchId: req.user.branchId,
            email: req.user.email,
            firstName: req.user.firstName,
            lastName: req.user.lastName,
            roleType: req.user.roleType,
            roles: req.user.roles // Include role if needed
        });
    } else {
        logger.error("User not found");
        res.status(404).send({ message: "User not found" });
    }
}


export const signOut = async (req: Request, res: Response): Promise<void> => {
    res.cookie("auth_token", "", {
        expires: new Date(0)
    });
    res.send();
}