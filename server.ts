import 'dotenv/config';
import express, { Request, Response, NextFunction } from "express";
import path from "path";
import helmet from "helmet";
import cors from "cors";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { initializeDatabase, purgeOldLogs, pool } from "./src/db/index";
import apiRoutes from "./src/db/apiRoutes";

/**
 * Parses and resolves the 'trust proxy' setting in a deployment-aware manner.
 * 
 * Priority:
 * 1. Explicit TRUST_PROXY env variable if provided:
 *    - "false" / "0" -> false (no proxy trusted, for local offline dev)
 *    - "1", "2", ... -> integer number of proxy hops
 *    - "loopback" / "linklocal" / "uniquelocal" / CIDR -> specific trusted subnet
 * 2. Automated detection of container / Cloud Run runtime (process.env.K_SERVICE or PORT === 3000 container):
 *    - Defaults to 1 hop (immediate reverse proxy ingress)
 * 3. Fallback for pure local dev:
 *    - false (direct socket remoteAddress)
 */
function resolveTrustProxySetting(): boolean | number | string {
  const envVal = process.env.TRUST_PROXY?.trim();

  if (envVal !== undefined && envVal !== "") {
    if (envVal.toLowerCase() === "false" || envVal === "0") {
      return false;
    }
    if (envVal.toLowerCase() === "true") {
      return 1; // Default boolean true to 1 hop for safety against header spoofing
    }
    const parsedNum = parseInt(envVal, 10);
    if (!isNaN(parsedNum) && parsedNum >= 0) {
      return parsedNum;
    }
    // String value like "loopback", "10.0.0.0/8", etc.
    return envVal;
  }

  // Auto-detection: Cloud Run injects K_SERVICE, standard dev container sets container environment
  const isCloudRunOrContainer = Boolean(process.env.K_SERVICE) || Boolean(process.env.CONTAINER);
  if (isCloudRunOrContainer) {
    return 1;
  }

  // Default: When running locally with npm run dev on workstation without env variable
  return false;
}

/**
 * Secure client IP resolver that respects Express's validated req.ip calculation.
 * Uses express-rate-limit's ipKeyGenerator helper to normalize IPv6 addresses
 * into standard /64 subnet blocks (preventing IPv6 rotation bypass).
 */
function getSecureClientIp(req: Request): string {
  const clientIp = req.ip || req.socket.remoteAddress || "127.0.0.1";
  return ipKeyGenerator(clientIp);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  if (process.env.NODE_ENV === "production") {
    const jwtSecret = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret || jwtSecret.trim() === "") {
      throw new Error("Refusing to start: JWT_SECRET (or SUPABASE_JWT_SECRET) must be set in production.");
    }
  }

  // Configure Trust Proxy dynamically based on deployment environment
  const trustProxySetting = resolveTrustProxySetting();
  app.set("trust proxy", trustProxySetting);

  console.log(`[PROXY CONFIG] Express 'trust proxy' configured as:`, trustProxySetting);

  const isProduction = process.env.NODE_ENV === "production";
  const supabaseOrigin = (() => {
    try {
      const raw = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
      return raw ? new URL(raw).origin : "";
    } catch {
      return "";
    }
  })();

  app.use(
    helmet({
      contentSecurityPolicy: isProduction
        ? {
            useDefaults: true,
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
              fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
              imgSrc: ["'self'", "data:", "blob:"],
              connectSrc: ["'self'", supabaseOrigin].filter(Boolean) as string[],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
              frameAncestors: ["'none'"],
              upgradeInsecureRequests: null
            }
          }
        : false,
      crossOriginEmbedderPolicy: false,
      frameguard: isProduction ? { action: "deny" } : false,
      referrerPolicy: { policy: "no-referrer" },
      hidePoweredBy: true
    })
  );

  const corsOrigins = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: corsOrigins.length
        ? corsOrigins.includes("*")
          ? true
          : corsOrigins
        : isProduction
          ? false
          : true,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Accept"]
    })
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));

  // Global Rate Limiter for all API routes (300 requests per minute per IP)
  const generalApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getSecureClientIp,
    message: { error: "Too many requests from this client. Please slow down." }
  });

  // Strict Rate Limiter for Authentication endpoints (20 attempts per 15 minutes)
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getSecureClientIp,
    message: { error: "Too many login attempts. Please try again after 15 minutes." }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/supabase-sync", authLimiter);
  app.use("/api/auth/change-password", authLimiter);
  app.use("/api", generalApiLimiter);

  // Mount Hardened API Routes
  app.use("/api", apiRoutes);

  // Catch-all for unmatched /api routes to prevent HTML fallthrough
  app.use("/api/*", (req, res) => {
    res.status(404).json({ error: `API endpoint not found: ${req.originalUrl}` });
  });

  // Centralized Error Handling Middleware (prevents leaking stack traces or database secrets)
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error("[SERVER ERROR CATCH-ALL]", {
      path: req.originalUrl,
      method: req.method,
      errorName: err.name,
      errorMessage: err.message
    });

    if (res.headersSent) {
      return next(err);
    }

    const statusCode = Number(err.status || err.statusCode) || 500;
    const safeStatus = statusCode >= 400 && statusCode < 600 ? statusCode : 500;
    res.status(safeStatus).json({
      error: err.expose && safeStatus < 500 ? err.message : "An unexpected server error occurred. Please try again later."
    });
  });

  // Vite middleware for development vs static files for production
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Start HTTP server immediately to satisfy container health checks
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SECURITY ENFORCED] Server running on http://0.0.0.0:${PORT}`);

    // Initialize PostgreSQL database schema after port binding
    initializeDatabase().then(() => {
      console.log("[SECURITY AUDIT] PostgreSQL database initialization complete.");

      // Run automated 90-day log cleanup on startup
      purgeOldLogs(pool, 90).then((res) => {
        console.log(`[RETENTION POLICY] Automated 90-day log cleanup executed on server startup (Purged ${res.activityLogsDeleted} activity logs, ${res.securityLogsDeleted} security logs).`);
      }).catch((err) => {
        console.error("[RETENTION POLICY] Initial log purge error:", err.message);
      });

      // Schedule automated daily purge (every 24 hours)
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
      setInterval(() => {
        purgeOldLogs(pool, 90).then((res) => {
          if (res.activityLogsDeleted > 0 || res.securityLogsDeleted > 0) {
            console.log(`[RETENTION POLICY] 24-hour scheduled purge completed: removed ${res.activityLogsDeleted} activity logs, ${res.securityLogsDeleted} security logs.`);
          }
        }).catch((err) => {
          console.error("[RETENTION POLICY] Scheduled daily log purge error:", err.message);
        });
      }, TWENTY_FOUR_HOURS);

    }).catch((err) => {
      console.error("Failed to initialize PostgreSQL DB on startup:", err);
    });
  });
}

startServer();
