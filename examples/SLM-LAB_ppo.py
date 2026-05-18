from copy import deepcopy
from slm_lab.agent.algorithm import policy_util
from slm_lab.agent.algorithm.actor_critic import (
    ActorCritic,
    PercentileNormalizer,
    ReturnNormalizer,
)
from slm_lab.agent.net import net_util
from slm_lab.lib import logger, math_util, util
from slm_lab.lib.decorator import lab_api
import math
import numpy as np
import torch

logger = logger.get_logger(__name__)


class PPO(ActorCritic):

    @lab_api
    def init_algorithm_params(self):
        """Initialize other algorithm parameters"""

        ##Pseudocode [line 2: Set β ≥ 0, entropy regularization weight]##
        ##Pseudocode [line 3: Set ε ≥ 0, the clipping variable]##
        ##Pseudocode [line 4: Set K, the number of epochs]##
        ##Pseudocode [line 5: Set N, the number of actors]##
        ##Pseudocode [line 6: Set T, the time horizon]##
        ##Pseudocode [line 7: Set M ≤ NT, the minibatch size]##
        ##Pseudocode [line 8: Set αA ≥ 0, actor learning rate]##
        ##Pseudocode [line 9: Set αC ≥ 0, critic learning rate]##

        util.set_attr(
            self,
            dict(
                action_pdtype="default",
                action_policy="default",
                explore_var_spec=None,
                entropy_coef_spec=None,
                minibatch_size=4,
                val_loss_coef=1.0,
                normalize_v_targets=False,
                clip_vloss=False,
                symlog=False,
                normalize_advantages="standardize",
            ),
        )

    @lab_api
    def init_nets(self, global_nets=None):
        """PPO uses old and new to calculate ratio for loss"""

        super().init_nets(global_nets)

        ##Pseudocode [line 11: Initialize the “old” actor network θAold]##
        self.old_net = deepcopy(self.net)

    def calc_policy_loss(self, batch, pdparams, advs):

        ##Pseudocode [line 19: Calculate rm(θA)]##
        ##Pseudocode [line 20: Calculate JmCLIP(θA) using the advantages Am from the minibatch and rm(θA)]##

        log_probs = policy_util.reduce_multi_action(
            policy_util.init_action_pd(self.agent.ActionPD, pdparams).log_prob(batch["actions"])
        )

        with torch.no_grad():
            old_pdparams = self.calc_pdparam(batch["states"], net=self.old_net)
            old_action_pd = policy_util.init_action_pd(self.agent.ActionPD, old_pdparams)
            old_log_probs = policy_util.reduce_multi_action(old_action_pd.log_prob(batch["actions"]))

        log_ratio = torch.clamp(log_probs - old_log_probs, -20.0, 20.0)
        ratios = torch.exp(log_ratio)

        ##Pseudocode [line 21: Calculate entropies Hm using using the actor network θA]##
        entropy = policy_util.reduce_multi_action(
            policy_util.init_action_pd(self.agent.ActionPD, pdparams).entropy()
        ).mean()

        ##Pseudocode [line 22: Calculate policy loss:]##
        ##Pseudocode [line 23: Lpol(θA) = JmCLIP(θA) − βHm]##
        clip_loss = -torch.min(ratios * advs, torch.clamp(ratios, 1 - self.clip_eps, 1 + self.clip_eps) * advs).mean()
        ent_penalty = -self.agent.entropy_coef * entropy

        return clip_loss + ent_penalty

    def calc_val_loss(self, v_preds, v_targets, old_v_preds=None):

        ##Pseudocode [line 25: Calculate predicted V -value Vˆ π(sm) using the critic network θC]##
        ##Pseudocode [line 26: Calculate value loss using the V -targets from the minibatch:]##
        return 0.5 * ((v_preds - v_targets) ** 2).mean()

    def train(self):

        ##Pseudocode [line 12: for i = 1, 2, . . . do]##
        if self.to_train == 1:

            ##Pseudocode [line 13: Set θAold = θA]##
            net_util.copy(self.net, self.old_net)

            batch = self.sample()

            ##Pseudocode [line 15: Run policy θAold in environment for T time steps and collect the trajectories]##
            ##Pseudocode [line 16: Compute advantages A1, . . . , AT using θAold]##
            ##Pseudocode [line 17: Calculate Vtarπ,1, . . . , Vtarπ,T using the critic network θC and/or trajectory data]##
            with torch.no_grad():
                states = batch["states"]
                v_preds = self.calc_v(states, use_cache=False)
                advs, v_targets = self.calc_advs_v_targets(batch, v_preds)

            ##Pseudocode [line 18: Let batch with size NT consist of the collected trajectories, advantages, and target V -values]##
            batch["advs"], batch["v_targets"], batch["old_v_preds"] = advs, v_targets, v_preds

            total_loss = 0.0

            ##Pseudocode [line 19: for epoch = 1, 2, . . . , K do]##
            for _ in range(self.training_epoch):

                minibatches = util.split_minibatch(batch, self.minibatch_size)

                ##Pseudocode [line 20: for minibatch m in batch do]##
                for minibatch in minibatches:

                    ##Pseudocode [line 21: The following are computed over the whole minibatch m]##
                    pdparams, v_preds = self.calc_pdparam_v(minibatch)

                    policy_loss = self.calc_policy_loss(minibatch, pdparams, minibatch["advs"])
                    val_loss = self.calc_val_loss(v_preds, minibatch["v_targets"], minibatch["old_v_preds"])

                    ##Pseudocode [line 27: Update actor parameters, for example using SGD:]##
                    ##Pseudocode [line 28: θA = θA + αA∇θA Lpol(θA)]##
                    ##Pseudocode [line 29: Update critic parameters, for example using SGD:]##
                    ##Pseudocode [line 30: θC = θC + αC∇θC Lval(θC )]##
                    loss = policy_loss + val_loss
                    self.net.train_step(loss, self.optim, self.lr_scheduler)

                    total_loss += loss.item()

            self.to_train = 0
            return total_loss

        else:
            return np.nan