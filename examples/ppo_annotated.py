##Pseudocode [line 11: Initialize the “old” actor network θAold]##

net_util.copy(self.net, self.old_net)  # update old net

batch = self.sample()
self.agent.env.set_batch_size(len(batch))

with torch.no_grad():
    states = batch["states"]
    if self.agent.env.is_venv:
        states = math_util.venv_unpack(states)
    # NOTE states is massive with batch_size = time_horizon * num_envs. Chunk up so forward pass can fit into device esp. GPU

    num_chunks = max(1, int(len(states) / self.minibatch_size))
    v_preds_chunks = [
        self.calc_v(states_chunk, use_cache=False)
        for states_chunk in torch.chunk(states, num_chunks)
    ]
    v_preds = torch.cat(v_preds_chunks)

    advs, v_targets = self.calc_advs_v_targets(batch, v_preds)

# piggy back on batch, but remember to not pack or unpack
# Store old v_preds for value clipping (CleanRL-style)
batch["advs"], batch["v_targets"], batch["old_v_preds"] = (
    advs,
    v_targets,
    v_preds,
)

if self.agent.env.is_venv:  # unpack if venv for minibatch sampling
    for k, v in batch.items():
        if k not in ("advs", "v_targets", "old_v_preds"):
            batch[k] = math_util.venv_unpack(v)

total_loss = 0.0

for _ in range(self.training_epoch):

    minibatches = util.split_minibatch(batch, self.minibatch_size)

    for minibatch in minibatches:
        if self.agent.env.is_venv:  # re-pack to restore proper shape
            for k, v in minibatch.items():
                if k not in ("advs", "v_targets", "old_v_preds"):
                    minibatch[k] = math_util.venv_pack(
                        v, self.agent.env.num_envs
                    )

        advs, v_targets, old_v_preds = (
            minibatch["advs"],
            minibatch["v_targets"],
            minibatch["old_v_preds"],
        )

        pdparams, v_preds = self.calc_pdparam_v(minibatch)
        policy_loss = self.calc_policy_loss(
            minibatch, pdparams, advs
        )  # from actor

        val_loss = self.calc_val_loss(
            v_preds, v_targets, old_v_preds
        )  # from critic

        if self.shared:  # shared network
            loss = policy_loss + val_loss
            self.net.train_step(
                loss,
                self.optim,
                self.lr_scheduler,
                global_net=self.global_net,
            )
            self.agent.env.tick_opt_step()
        else:
            self.net.train_step(
                policy_loss,
                self.optim,
                self.lr_scheduler,
                global_net=self.global_net,
            )
            self.critic_net.train_step(
                val_loss,
                self.critic_optim,
                self.critic_lr_scheduler,
                global_net=self.global_critic_net,
            )
            self.agent.env.tick_opt_step()
            self.agent.env.tick_opt_step()
            loss = policy_loss + val_loss

        total_loss += loss.item()

# Step LR scheduler once per training iteration (per batch of collected experience)
# This ensures proper LR decay matching CleanRL's approach
if self.lr_scheduler is not None:
    self.lr_scheduler.step()

if (
    not self.shared
    and hasattr(self, "critic_lr_scheduler")
    and self.critic_lr_scheduler is not None
):
    self.critic_lr_scheduler.step()

loss = total_loss / self.training_epoch / len(minibatches)

# reset
self.to_train = 0

logger.debug(
    f"Trained {self.name} at epi: {self.agent.env.get('epi')}, frame: {self.agent.env.get('frame')}, t: {self.agent.env.get('t')}, total_reward so far: {self.agent.env.total_reward}, loss: {loss:g}"
)

return loss