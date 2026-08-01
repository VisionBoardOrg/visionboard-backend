import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthenticatedRequest extends Request {
  userId: string;
  userEmail: string;
}

/**
 * Verifies the NextAuth.js JWT token sent in the Authorization header.
 * The frontend must send: Authorization: Bearer <nextauth-jwt-token>
 * 
 * NextAuth JWT tokens are signed with AUTH_SECRET (same secret used by Next.js).
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing authentication token" });
    return;
  }

  const token = authHeader.slice(7);
  const secret = process.env.AUTH_SECRET;

  if (!secret) {
    console.error("AUTH_SECRET not set — cannot verify JWT tokens");
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as { sub?: string; email?: string; id?: string };
    const userId = (decoded.sub ?? decoded.id ?? "") as string;

    if (!userId) {
      res.status(401).json({ error: "Invalid token: missing user ID claim" });
      return;
    }

    (req as AuthenticatedRequest).userId = userId;
    (req as AuthenticatedRequest).userEmail = (decoded.email ?? "") as string;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/** Helper to get typed request */
export function asAuthed(req: Request): AuthenticatedRequest {
  return req as AuthenticatedRequest;
}
