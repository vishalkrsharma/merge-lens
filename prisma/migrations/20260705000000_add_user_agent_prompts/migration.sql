-- CreateTable
CREATE TABLE "user_agent_prompts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_agent_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_agent_prompts_user_id_agent_key" ON "user_agent_prompts"("user_id", "agent");

-- AddForeignKey
ALTER TABLE "user_agent_prompts" ADD CONSTRAINT "user_agent_prompts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
