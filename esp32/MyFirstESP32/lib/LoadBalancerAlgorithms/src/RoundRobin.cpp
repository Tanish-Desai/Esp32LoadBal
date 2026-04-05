// RoundRobin.cpp
#include "RoundRobin.h"

RoundRobin::RoundRobin(int backends) : num_backends(backends), current_idx(0) {}

int RoundRobin::getNextBackend(int current_state) {
    int selected = current_idx;
    current_idx = (current_idx + 1) % num_backends;
    return selected;
}