

class SimpleQueue {
    constructor() {
        this.arr = [];
    }
    enqueue(item) { this.arr.push(item)}
    dequeue() { return this.arr.shift()}
    size() { return this.arr.length}
    list() { return [...this.arr]}
    clear() { this.arr.length = 0}
}

module.exports = {SimpleQueue}