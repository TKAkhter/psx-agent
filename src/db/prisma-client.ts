import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: [
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

(prisma as unknown as { $on: (e: string, cb: (event: { message: string }) => void) => void })
  .$on('error', (e: { message: string }) => logger.error({ msg: e.message }, 'Prisma error'));

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
