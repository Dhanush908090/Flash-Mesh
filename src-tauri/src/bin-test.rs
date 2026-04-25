use trash::os_limited;
fn main() {
    let items = os_limited::list().unwrap();
    println!("Trash items: {}", items.count());
}
