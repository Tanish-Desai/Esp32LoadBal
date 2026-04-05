// RoundRobin.h
#pragma once
#include "LoadBalancerStrategy.h"

class RoundRobin : public LoadBalancerStrategy {
private:
    int num_backends;
    int current_idx;
public:
    RoundRobin(int backends);
    int getNextBackend(int current_state = 0) override;
};